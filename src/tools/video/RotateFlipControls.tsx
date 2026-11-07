type Props = {
  values: Record<string, string>;
  set: (key: string, value: string) => void;
};

export default function RotateFlipControls({ values, set }: Props) {
  return <>
    <label className="video-tool-field">Rotation
      <select aria-label="Rotation" value={values.angle ?? '0'} onChange={event => set('angle', event.target.value)}>
        <option value="0">None</option>
        <option value="90">90° clockwise</option>
        <option value="180">180°</option>
        <option value="270">90° counterclockwise</option>
      </select>
    </label>
    <label className="video-tool-field">Flip
      <select aria-label="Flip" value={values.direction ?? 'none'} onChange={event => set('direction', event.target.value)}>
        <option value="none">None</option>
        <option value="horizontal">Horizontal</option>
        <option value="vertical">Vertical</option>
      </select>
    </label>
  </>;
}
