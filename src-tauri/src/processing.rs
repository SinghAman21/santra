use std::{
    fs,
    io::{Cursor, Read},
    path::Path,
    process::Command,
    sync::OnceLock,
    time::Duration,
};

use base64::{engine::general_purpose::STANDARD, Engine};
use image::{
    codecs::jpeg::JpegEncoder,
    imageops::{self, FilterType},
    DynamicImage, GenericImageView, ImageDecoder, ImageFormat, ImageReader, Rgba, RgbaImage,
};
use serde_json::{json, Value};

const MAX_SOURCE_BYTES: u64 = 128 * 1024 * 1024;
const MAX_PIXELS: u64 = 40_000_000;

const IMAGE_INPUTS: &[&str] = &[
    "jpg", "jpeg", "png", "webp", "tif", "tiff", "bmp", "gif", "avif",
];
const IMAGE_OUTPUTS: &[&str] = &[
    "jpg", "jpeg", "png", "webp", "tif", "tiff", "bmp", "gif", "avif",
];

pub fn capabilities() -> Vec<Value> {
    let mut routes = ["convert", "compress", "resize", "crop", "rotate", "strip-metadata", "edit-image", "background"]
        .iter()
        .map(|operation| json!({
            "id": format!("image:{operation}"),
            "operation": operation,
            "label": if *operation == "strip-metadata" { "Delete metadata".to_string() } else { format!("{} image", operation.replace('-', " ")) },
            "category": "image",
            "inputs": IMAGE_INPUTS,
            "outputs": IMAGE_OUTPUTS,
            "backend": "rust-image",
            "available": true,
            "batch": true,
            "preservesMetadata": false,
            "options": {},
            "warning": "Local raster processing; 40 megapixel limit. EXIF and other metadata are removed. Animated images use the first frame."
        }))
        .collect::<Vec<_>>();
    if metadata_available() {
        routes.push(json!({ "id": "image:metadata", "operation": "metadata", "label": "Edit image metadata",
            "category": "image", "inputs": ["jpg", "jpeg"], "outputs": ["jpg", "jpeg"], "backend": "exiftool",
            "available": true, "batch": true, "preservesMetadata": true, "options": {},
            "warning": "Local EXIF editing preserves other source metadata where ExifTool supports it. Save a new JPEG copy." }));
    }
    routes
}

pub fn metadata_available() -> bool {
    static AVAILABLE: OnceLock<bool> = OnceLock::new();
    *AVAILABLE.get_or_init(|| {
        let mut command = Command::new("exiftool");
        command.arg("-ver");
        crate::media::captured(command, Duration::from_secs(5), || false).is_ok()
    })
}

pub fn edit_metadata(
    input: &Path,
    output: &Path,
    options: &Value,
    cancelled: impl Fn() -> bool,
) -> Result<(), String> {
    if !metadata_available() {
        return Err("ExifTool is unavailable".into());
    }
    let extension = input
        .extension()
        .and_then(|part| part.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !["jpg", "jpeg"].contains(&extension.as_str()) {
        return Err("Metadata editing supports JPEG files".into());
    }
    load_image(input)?;
    let mut command = Command::new("exiftool");
    command.args(["-q", "-q", "-m", "-o"]).arg(output);
    if options
        .get("stripMetadata")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        command.arg("-all=");
    } else {
        for (key, tag) in [
            ("artist", "Artist"),
            ("copyright", "Copyright"),
            ("description", "ImageDescription"),
            ("dateTime", "DateTimeOriginal"),
        ] {
            if let Some(value) = options.get(key) {
                let value = value.as_str().ok_or_else(|| format!("Invalid {key}"))?;
                if value.len() > 512 || value.chars().any(char::is_control) {
                    return Err(format!("Invalid {key}"));
                }
                if key == "dateTime"
                    && !value.is_empty()
                    && (value.len() != 19
                        || !value.chars().enumerate().all(|(index, character)| {
                            if [4, 7].contains(&index) {
                                character == ':'
                            } else if index == 10 {
                                character == ' '
                            } else if [13, 16].contains(&index) {
                                character == ':'
                            } else {
                                character.is_ascii_digit()
                            }
                        }))
                {
                    return Err("Use YYYY:MM:DD HH:MM:SS for the EXIF date".into());
                }
                if !value.is_empty() {
                    command.arg(format!("-{tag}={value}"));
                }
            }
        }
    }
    command.arg(input);
    crate::media::captured(command, Duration::from_secs(30), cancelled)
        .map_err(|_| "Local metadata editing failed".to_string())?;
    if !output.is_file() {
        return Err("Metadata copy was not created".into());
    }
    Ok(())
}

fn format_for_extension(extension: &str) -> Result<ImageFormat, String> {
    match extension.to_ascii_lowercase().as_str() {
        "jpg" | "jpeg" => Ok(ImageFormat::Jpeg),
        "png" => Ok(ImageFormat::Png),
        "webp" => Ok(ImageFormat::WebP),
        "tif" | "tiff" => Ok(ImageFormat::Tiff),
        "bmp" => Ok(ImageFormat::Bmp),
        "gif" => Ok(ImageFormat::Gif),
        "avif" => Ok(ImageFormat::Avif),
        _ => Err("Unsupported image format".into()),
    }
}

fn load_image(path: &Path) -> Result<DynamicImage, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    if !metadata.is_file() || metadata.len() > MAX_SOURCE_BYTES {
        return Err("Image exceeds the 128 MiB source limit".into());
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    fs::File::open(path)
        .map_err(|error| error.to_string())?
        .take(MAX_SOURCE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > MAX_SOURCE_BYTES {
        return Err("Image exceeds the 128 MiB source limit".into());
    }
    let reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|error| error.to_string())?;
    let format = reader.format().ok_or("Unsupported image signature")?;
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if format_for_extension(extension)? != format {
        return Err("Image signature does not match its extension".into());
    }
    let mut decoder = reader.into_decoder().map_err(|error| error.to_string())?;
    let (width, height) = decoder.dimensions();
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > MAX_PIXELS {
        return Err("Image exceeds the 40 megapixel limit".into());
    }
    let orientation = decoder.orientation().map_err(|error| error.to_string())?;
    let mut image = DynamicImage::from_decoder(decoder).map_err(|error| error.to_string())?;
    image.apply_orientation(orientation);
    Ok(image)
}

fn number(options: &Value, key: &str, default: u32, min: u32, max: u32) -> Result<u32, String> {
    let value = match options.get(key) {
        None => default,
        Some(Value::Number(value)) => {
            u32::try_from(value.as_u64().ok_or_else(|| format!("Invalid {key}"))?)
                .map_err(|_| format!("Invalid {key}"))?
        }
        Some(Value::String(value)) => value.parse::<u32>().map_err(|_| format!("Invalid {key}"))?,
        _ => return Err(format!("Invalid {key}")),
    };
    if !(min..=max).contains(&value) {
        return Err(format!("Invalid {key}"));
    }
    Ok(value)
}

fn option<'a>(options: &'a Value, key: &str, default: &'a str) -> Result<&'a str, String> {
    match options.get(key) {
        None => Ok(default),
        Some(Value::String(value)) => Ok(value),
        _ => Err(format!("Invalid {key}")),
    }
}

fn scalar(options: &Value, key: &str, default: f32, min: f32, max: f32) -> Result<f32, String> {
    let value = match options.get(key) {
        None => default,
        Some(Value::String(value)) => value.parse::<f32>().map_err(|_| format!("Invalid {key}"))?,
        Some(Value::Number(value)) => {
            value.as_f64().ok_or_else(|| format!("Invalid {key}"))? as f32
        }
        _ => return Err(format!("Invalid {key}")),
    };
    if !value.is_finite() || !(min..=max).contains(&value) {
        return Err(format!("Invalid {key}"));
    }
    Ok(value)
}

fn color(options: &Value, key: &str, default: &str) -> Result<Rgba<u8>, String> {
    let text = option(options, key, default)?;
    if text.len() != 7 || !text.starts_with('#') {
        return Err(format!("Invalid {key}"));
    }
    let red = u8::from_str_radix(&text[1..3], 16).map_err(|_| format!("Invalid {key}"))?;
    let green = u8::from_str_radix(&text[3..5], 16).map_err(|_| format!("Invalid {key}"))?;
    let blue = u8::from_str_radix(&text[5..7], 16).map_err(|_| format!("Invalid {key}"))?;
    Ok(Rgba([red, green, blue, 255]))
}

fn rotate_any(image: DynamicImage, degrees: f32) -> Result<DynamicImage, String> {
    let source = image.to_rgba8();
    let (width, height) = source.dimensions();
    let radians = degrees.to_radians();
    let (sin, cos) = radians.sin_cos();
    let out_width = ((width as f32 * cos.abs() + height as f32 * sin.abs()).ceil() as u32).max(1);
    let out_height = ((height as f32 * cos.abs() + width as f32 * sin.abs()).ceil() as u32).max(1);
    if u64::from(out_width) * u64::from(out_height) > MAX_PIXELS {
        return Err("Rotation exceeds the pixel limit".into());
    }
    let mut output = RgbaImage::new(out_width, out_height);
    for y in 0..out_height {
        for x in 0..out_width {
            let dx = x as f32 + 0.5 - out_width as f32 / 2.0;
            let dy = y as f32 + 0.5 - out_height as f32 / 2.0;
            let sx = cos * dx + sin * dy + width as f32 / 2.0 - 0.5;
            let sy = -sin * dx + cos * dy + height as f32 / 2.0 - 0.5;
            if sx >= 0.0 && sy >= 0.0 && sx < width as f32 && sy < height as f32 {
                output.put_pixel(
                    x,
                    y,
                    *source.get_pixel(
                        sx.round().min((width - 1) as f32) as u32,
                        sy.round().min((height - 1) as f32) as u32,
                    ),
                );
            }
        }
    }
    Ok(DynamicImage::ImageRgba8(output))
}

fn add_background(image: DynamicImage, options: &Value) -> Result<DynamicImage, String> {
    let (source_width, source_height) = image.dimensions();
    let padding = number(options, "padding", 32, 0, 16_384)?;
    let default_width = source_width
        .checked_add(padding.saturating_mul(2))
        .ok_or("Canvas exceeds the pixel limit")?;
    let default_height = source_height
        .checked_add(padding.saturating_mul(2))
        .ok_or("Canvas exceeds the pixel limit")?;
    let width = number(options, "width", default_width, 1, 16_384)?;
    let height = number(options, "height", default_height, 1, 16_384)?;
    if u64::from(width) * u64::from(height) > MAX_PIXELS {
        return Err("Canvas exceeds the pixel limit".into());
    }
    let kind = option(options, "backgroundType", "solid")?;
    let first = color(options, "backgroundColor", "#fff4e8")?;
    let second = color(options, "backgroundColor2", "#e69b73")?;
    let mut canvas = if kind == "image" {
        let path = option(options, "backgroundImage", "")?;
        if path.is_empty() {
            return Err("Choose a local background image".into());
        }
        load_image(Path::new(path))?
            .resize_to_fill(width, height, FilterType::Lanczos3)
            .to_rgba8()
    } else {
        RgbaImage::new(width, height)
    };
    if kind != "image" {
        for y in 0..height {
            for x in 0..width {
                let pixel = match kind {
                    "transparent" => Rgba([0, 0, 0, 0]),
                    "solid" | "landscape" | "portrait" | "custom" => first,
                    "gradient" => {
                        let t = (x as f32 / width.saturating_sub(1).max(1) as f32
                            + y as f32 / height.saturating_sub(1).max(1) as f32)
                            / 2.0;
                        Rgba([
                            ((1.0 - t) * first[0] as f32 + t * second[0] as f32).round() as u8,
                            ((1.0 - t) * first[1] as f32 + t * second[1] as f32).round() as u8,
                            ((1.0 - t) * first[2] as f32 + t * second[2] as f32).round() as u8,
                            255,
                        ])
                    }
                    _ => return Err("Invalid background type".into()),
                };
                canvas.put_pixel(x, y, pixel);
            }
        }
    }
    let inner_width = width.saturating_sub(padding.saturating_mul(2)).max(1);
    let inner_height = height.saturating_sub(padding.saturating_mul(2)).max(1);
    let fitted = match option(options, "fit", "contain")? {
        "contain" => image.resize(inner_width, inner_height, FilterType::Lanczos3),
        "cover" => image.resize_to_fill(inner_width, inner_height, FilterType::Lanczos3),
        "fill" => image.resize_exact(inner_width, inner_height, FilterType::Lanczos3),
        _ => return Err("Invalid fit".into()),
    };
    imageops::overlay(
        &mut canvas,
        &fitted.to_rgba8(),
        i64::from(width.saturating_sub(fitted.width()) / 2),
        i64::from(height.saturating_sub(fitted.height()) / 2),
    );
    Ok(DynamicImage::ImageRgba8(canvas))
}

fn transform(
    mut image: DynamicImage,
    operation: &str,
    options: &Value,
) -> Result<DynamicImage, String> {
    let (width, height) = image.dimensions();
    match operation {
        "convert" | "compress" | "strip-metadata" | "metadata" => {}
        "resize" => {
            let target_width = number(options, "width", width, 1, 16_384)?;
            let target_height = number(options, "height", height, 1, 16_384)?;
            if u64::from(target_width) * u64::from(target_height) > MAX_PIXELS {
                return Err("Resize exceeds the pixel limit".into());
            }
            image = match option(options, "fit", "inside")? {
                "inside" => image.resize(target_width, target_height, FilterType::Lanczos3),
                "cover" => image.resize_to_fill(target_width, target_height, FilterType::Lanczos3),
                "fill" => image.resize_exact(target_width, target_height, FilterType::Lanczos3),
                _ => return Err("Invalid fit".into()),
            };
        }
        "crop" => {
            let x = number(options, "x", 0, 0, width - 1)?;
            let y = number(options, "y", 0, 0, height - 1)?;
            let w = number(options, "width", width - x, 1, width)?;
            let h = number(options, "height", height - y, 1, height)?;
            if x + w > width || y + h > height {
                return Err("Crop exceeds image bounds".into());
            }
            image = image.crop_imm(x, y, w, h);
        }
        "rotate" => {
            image = match scalar(options, "angle", 90.0, -180.0, 180.0)? {
                0.0 => image,
                90.0 | -270.0 => image.rotate90(),
                180.0 | -180.0 => image.rotate180(),
                -90.0 | 270.0 => image.rotate270(),
                degrees => rotate_any(image, degrees)?,
            };
            for key in ["flipHorizontal", "flipVertical"] {
                let enabled = match options.get(key) {
                    None | Some(Value::Null) => false,
                    Some(Value::Bool(value)) => *value,
                    Some(Value::String(value)) if value == "true" || value == "false" => {
                        value == "true"
                    }
                    _ => return Err(format!("Invalid {key}")),
                };
                if enabled {
                    image = if key == "flipHorizontal" {
                        image.fliph()
                    } else {
                        image.flipv()
                    };
                }
            }
        }
        "flip" => {
            image = match option(options, "direction", "horizontal")? {
                "horizontal" => image.fliph(),
                "vertical" => image.flipv(),
                _ => return Err("Invalid flip direction".into()),
            };
        }
        "edit-image" => {
            let brightness = scalar(options, "brightness", 1.0, 0.0, 2.0)?;
            let contrast = scalar(options, "contrast", 1.0, 0.0, 2.0)?;
            let saturation = scalar(options, "saturation", 1.0, 0.0, 2.0)?;
            let mut pixels = image.to_rgba8();
            for pixel in pixels.pixels_mut() {
                let [r, g, b, a] = pixel.0;
                let gray = 0.2126 * r as f32 + 0.7152 * g as f32 + 0.0722 * b as f32;
                for (index, channel) in [r, g, b].iter().enumerate() {
                    let colored = gray + (*channel as f32 - gray) * saturation;
                    pixel[index] = ((colored * brightness - 127.5) * contrast + 127.5)
                        .round()
                        .clamp(0.0, 255.0) as u8;
                }
                pixel[3] = a;
            }
            image = DynamicImage::ImageRgba8(pixels);
        }
        "background" => image = add_background(image, options)?,
        _ => return Err("Unsupported image operation".into()),
    }
    Ok(image)
}

fn encode(image: &DynamicImage, extension: &str, quality: u8) -> Result<Vec<u8>, String> {
    let format = format_for_extension(extension)?;
    let mut bytes = Vec::new();
    if format == ImageFormat::Jpeg {
        JpegEncoder::new_with_quality(&mut bytes, quality)
            .encode_image(image)
            .map_err(|error| error.to_string())?;
    } else {
        image
            .write_to(&mut Cursor::new(&mut bytes), format)
            .map_err(|error| error.to_string())?;
    }
    Ok(bytes)
}

pub fn convert_image(
    input: &Path,
    operation: &str,
    extension: &str,
    options: &Value,
    quality: u8,
) -> Result<Vec<u8>, String> {
    if !IMAGE_OUTPUTS.contains(&extension) {
        return Err("Unsupported image output format".into());
    }
    let image = transform(load_image(input)?, operation, options)?;
    encode(&image, extension, quality)
}

pub fn image_preview(input: &Path, operation: &str, options: &Value) -> Result<Value, String> {
    let source = load_image(input)?;
    let (source_width, source_height) = source.dimensions();
    let image = transform(source, operation, options)?.resize(1024, 1024, FilterType::Lanczos3);
    let (width, height) = image.dimensions();
    let bytes = encode(&image, "png", 85)?;
    if bytes.len() > 12 * 1024 * 1024 {
        return Err("Preview exceeds 12 MiB".into());
    }
    Ok(
        json!({ "url": format!("data:image/png;base64,{}", STANDARD.encode(bytes)), "width": width, "height": height, "sourceWidth": source_width, "sourceHeight": source_height }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rotation_recipe_applies_flips_and_rejects_invalid_flags() {
        let mut pixels = RgbaImage::new(2, 1);
        pixels.put_pixel(0, 0, Rgba([255, 0, 0, 255]));
        pixels.put_pixel(1, 0, Rgba([0, 0, 255, 255]));
        let source = DynamicImage::ImageRgba8(pixels);
        let output = transform(
            source.clone(),
            "rotate",
            &json!({"angle":0,"flipHorizontal":"true"}),
        )
        .unwrap();
        assert_eq!(output.to_rgba8().get_pixel(0, 0).0, [0, 0, 255, 255]);
        assert!(transform(source, "rotate", &json!({"angle":0,"flipVertical":"maybe"})).is_err());
    }

    #[test]
    fn converts_and_rotates_a_local_image_after_signature_check() {
        let path = std::env::temp_dir().join(format!("santra-test-{}.png", uuid::Uuid::new_v4()));
        let source = DynamicImage::new_rgba8(4, 2);
        source.save_with_format(&path, ImageFormat::Png).unwrap();
        let converted = convert_image(&path, "rotate", "png", &json!({ "angle": 90 }), 85).unwrap();
        assert_eq!(
            image::load_from_memory(&converted).unwrap().dimensions(),
            (2, 4)
        );
        let wrong_extension = path.with_extension("jpg");
        fs::rename(&path, &wrong_extension).unwrap();
        assert!(convert_image(&wrong_extension, "convert", "png", &json!({}), 85).is_err());
        fs::remove_file(wrong_extension).unwrap();
    }

    #[test]
    fn editor_recipes_render_and_reject_invalid_canvas() {
        let image = DynamicImage::ImageRgba8(RgbaImage::from_pixel(8, 4, Rgba([100, 50, 20, 255])));
        let adjusted = transform(
            image.clone(),
            "edit-image",
            &json!({"brightness": "1.5", "contrast": "1", "saturation": "1"}),
        )
        .unwrap();
        assert!(adjusted.to_rgba8().get_pixel(0, 0)[0] > 100);
        let canvas = transform(
            image.clone(),
            "background",
            &json!({"width": "20", "height": "12", "padding": "2", "backgroundType": "gradient"}),
        )
        .unwrap();
        assert_eq!(canvas.dimensions(), (20, 12));
        assert_ne!(
            canvas.to_rgba8().get_pixel(0, 0),
            canvas.to_rgba8().get_pixel(19, 11)
        );
        assert!(transform(
            image.clone(),
            "background",
            &json!({"width": "16384", "height": "16384"})
        )
        .is_err());
        assert!(transform(image, "rotate", &json!({"angle": "45"})).is_ok());
    }
}
