import type { LocalFile } from '../../common/types';
import type { RefObject } from 'react';
export interface ImageControls {
 values: Record<string,string>; set: (key:string,value:string)=>void;
 preview: {width?:number;height?:number;sourceWidth?:number;sourceHeight?:number}|null;
 originalDimensions: RefObject<{width:number;height:number}|null>;
 ratio:string; setRatio:(value:string)=>void; setCropRatio:(value:string)=>void;
 file:LocalFile; format:string; outputFormats:string[]; onFormatChange:(format:string)=>void;
}
