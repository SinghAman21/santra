import { AudioLines, BookOpen, File, FileArchive, FileImage, FileSpreadsheet, FileText, FileVideo, Layers, ListVideo, FileQuestion, Crop, Scaling, RotateCw, FlipHorizontal2, Minimize2, Scissors, Split, Merge, Gauge, Camera, VolumeX, EyeOff, Tag, Music2, Film, SlidersHorizontal, Volume2, LayoutGrid, ArrowDownToLine, FolderArchive, Package, FileOutput } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { WheelFamily } from './file-kind';
export interface WheelProfile { title:string; icon:LucideIcon; formats:string[]; tools:string[]; noTools:string }
export const wheelProfiles:Record<WheelFamily,WheelProfile>={
 image:{title:'Image',icon:FileImage,formats:['WEBP','JPG','PNG','TIFF','AVIF','BMP','GIF','PDF'],tools:['compress','crop','resize','rotate','background','edit-image','metadata'],noTools:'No image tools available for this selection'},
 video:{title:'Video',icon:FileVideo,formats:['MP4','MOV','MKV','WEBM','AVI','WMV','GIF'],tools:['compress','trim','split','crop','resize','rotate','flip','speed','snapshot','mute','redact','strip-metadata','merge','gif','extract-audio'],noTools:'No video tools available. Check the local FFmpeg engine.'},
 audio:{title:'Audio',icon:AudioLines,formats:['M4A','WAV','FLAC','OGG','OPUS','AIFF','WMA','MP3'],tools:['compress','strip-metadata','normalize','visualize','trim','channels','split','merge'],noTools:'No audio tools available. Check the local FFmpeg engine.'},
 pdf:{title:'PDF',icon:FileText,formats:['TXT','PDF'],tools:['pdf-organize','pdf-merge','pdf-split','pdf-extract','pdf-insert','compress','redact','metadata','render'],noTools:'No PDF tools available. Check local PDF engines.'},
 archive:{title:'Archive',icon:FileArchive,formats:['ZIP','TAR','GZ'],tools:['extract','create-archive'],noTools:'No archive tools available for this selection'},
 document:{title:'Document',icon:FileText,formats:['DOCX','MD','TXT','HTML','EPUB'],tools:[],noTools:'No tools available for this file'},
 epub:{title:'EPUB',icon:BookOpen,formats:['DOCX','MD','TXT','HTML','EPUB'],tools:[],noTools:'No tools available for this file'},
 presentation:{title:'Presentation',icon:Layers,formats:['PDF'],tools:[],noTools:'No tools available for this file'},
 spreadsheet:{title:'Spreadsheet',icon:FileSpreadsheet,formats:['XLSX','XLS','ODS','CSV','TSV','PDF'],tools:['split','strip-metadata'],noTools:'No tools available for this file'},
 subtitle:{title:'Subtitle',icon:ListVideo,formats:['SRT','VTT','TXT'],tools:[],noTools:'No tools available for this file'},
 other:{title:'File',icon:FileQuestion,formats:[],tools:[],noTools:'No tools available for this file'},
 mixed:{title:'Mixed selection',icon:File,formats:[],tools:[],noTools:'No shared tools available for this selection'},
};
export const operationIcons:Record<string,LucideIcon>={compress:Minimize2,trim:Scissors,split:Split,merge:Merge,crop:Crop,resize:Scaling,rotate:RotateCw,flip:FlipHorizontal2,speed:Gauge,snapshot:Camera,mute:VolumeX,redact:EyeOff,metadata:Tag,'strip-metadata':Tag,'extract-audio':Music2,gif:Film,normalize:SlidersHorizontal,channels:Volume2,visualize:AudioLines,'pdf-organize':LayoutGrid,'pdf-split':Split,'pdf-insert':FileOutput,'pdf-merge':Merge,'pdf-extract':FileOutput,'pdf-rotate':RotateCw,render:FileImage,extract:FolderArchive,'create-archive':Package};
export const operationLabels:Record<string,string>={compress:'Compress',trim:'Trim',split:'Split',merge:'Merge',crop:'Crop',resize:'Resize',rotate:'Rotate',flip:'Flip',speed:'Speed',snapshot:'Frames',mute:'Mute',redact:'Redact',metadata:'Metadata','strip-metadata':'Delete metadata','extract-audio':'Extract audio',gif:'Create GIF',normalize:'Normalize',channels:'Channels',visualize:'Visualize','pdf-organize':'Organize','pdf-split':'Split','pdf-insert':'Insert','pdf-merge':'Merge','pdf-extract':'Extract pages','pdf-rotate':'Rotate pages',render:'Export pages',extract:'Extract','create-archive':'Create archive'};
