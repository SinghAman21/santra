import { Music2, VolumeX } from 'lucide-react';
import { isAudioFormat } from './media';

type Props = {
  format: string;
  outputs: string[];
  setFormat: (format: string) => void;
};

export default function AudioOutputControls({ format, outputs, setFormat }: Props) {
  const audio = isAudioFormat(format);
  const audioFormat = outputs.find(isAudioFormat) || 'mp3';
  const videoFormat = outputs.find(item => !isAudioFormat(item)) || 'mp4';
  return <>
    <div className="video-mode-switch video-settings-wide" role="group" aria-label="Audio output mode">
      <button type="button" aria-pressed={!audio} className={!audio ? 'selected' : ''} onClick={() => setFormat(videoFormat)}>
        <VolumeX size={15}/><span>Remove audio<small>Save a muted video</small></span>
      </button>
      <button type="button" aria-pressed={audio} className={audio ? 'selected' : ''} onClick={() => setFormat(audioFormat)}>
        <Music2 size={15}/><span>Extract audio<small>Save the audio track</small></span>
      </button>
    </div>
  </>;
}
