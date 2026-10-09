// Pixelarticons (MIT, 24×24 pixel grid) for every generic interface icon. Site logos live in /public/icons.
import type {ComponentType,SVGProps} from 'react';
export {Chart,Trophy,BookOpen,Users,Play,Bookmark,Plus,Download,Pencil,Upload,Sparkles,Calculator,ArrowLeft,Clock,Target,Home,Zap,Message,Close,Reload,Trash,ExternalLink,ChevronDown,Notes,Check,SettingsCog,WarningDiamond,Eye} from 'pixelarticons/react';
export function Px({icon:Icon,size=16}:{icon:ComponentType<SVGProps<SVGSVGElement>>;size?:number}){return <Icon width={size} height={size} aria-hidden="true" className="px-icon"/>;}
