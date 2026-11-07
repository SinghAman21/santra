import type { Preview } from './media';
type Props = {
  preview: Preview | null;
  previewError: string;
};
export default function StripMetadataControls({ preview, previewError }: Props) {
  return <div className="video-tool-metadata video-settings-wide">{preview?.metadata ? Object.entries(preview.metadata).map(([key, value]) => <div key={key}><span>{key}</span><b>{String(value)}</b></div>) : <span>{previewError || 'Metadata details are unavailable until the preview is inspected.'}</span>}</div>;
}
