// Interface icons: Lucide (ISC licence), one consistent line style at 1.75 stroke. Site logos live in /public/icons.
import type {ComponentType,SVGProps} from 'react';
export {Menu,Share2 as Share,BarChart3 as Chart,Trophy,BookOpen,Users,Play,Bookmark,Plus,Download,Pencil,Upload,Sparkles,Calculator,ArrowLeft,Clock,Target,House as Home,Zap,MessageSquare as Message,X as Close,RefreshCw as Reload,Trash2 as Trash,ExternalLink,ChevronDown,NotebookText as Notes,Check,Settings as SettingsCog,TriangleAlert as WarningDiamond,Eye,User,Star,Send} from 'lucide-react';
export function Px({icon:Icon,size=16}:{icon:ComponentType<SVGProps<SVGSVGElement>&{size?:number;strokeWidth?:number}>;size?:number}){return <Icon width={size} height={size} strokeWidth={1.75} aria-hidden="true" className="px-icon"/>;}
