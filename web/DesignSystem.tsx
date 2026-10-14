import {useState} from 'react';
import {Button,IconButton,Field,Tag,CountBadge,Toggle,Segmented,Card,Panel,Notice,Empty,Tabs,TabLinks,ModeSwitch,ModalFooter,Chip,ChipLabel,ChoiceChip,Toast,LinkButton,Checkbox,Switch,MegaOrb} from './ui.tsx';
import {GoogleButton} from './auth.tsx';
import {Px,Plus,Pencil,Trash,Close,Check,Sparkles} from './icons.tsx';

// #design-system: every component in both themes, side by side (stacked on phones). Built only from ui.tsx components
// and their classes; the ds-* rules in jade.css just lay the specimens out.
const SPACE=[['s1',4],['s2',8],['s3',12],['s4',16],['s6',24],['s8',32],['s12',48]] as const;
const COLOURS=['bg','glass','sunk','tx','mu','ln','ac','gd','hot'];
// Every state of every control, forced without interaction: data-state="hover|focus|active" mirrors the pseudo-class
// in the component CSS; disabled is the real attribute; selected is the component's own on/selected state.
const STATES=['Default','Hover','Focus','Active','Disabled','Selected'] as const;
type St=typeof STATES[number];
const attrs=(st:St):any=>st==='Hover'?{'data-state':'hover'}:st==='Focus'?{'data-state':'focus'}:st==='Active'?{'data-state':'active'}:st==='Disabled'?{disabled:true}:{};
const star=<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9z"/></svg>;
// Selected (pressed, chosen, open) only where the control has that state.
const SELECTABLE=new Set(["Chip", "Ghost", "Icon ghost", "Mega", "Star", "Switch", "Tab links", "Tabs", "Tile", "Toggle"]);
const ROWS:[string,(st:St)=>any][]=[
  ['Button',st=><Button {...attrs(st)}>Secondary</Button>],
  ['Primary',st=><Button variant="primary" {...attrs(st)}>Save</Button>],
  ['Danger',st=><Button variant="danger" {...attrs(st)}>Delete</Button>],
  ['Danger solid',st=><Button variant="danger" solid {...attrs(st)}>Delete team</Button>],
  ['Quiet',st=><Button variant="quiet" {...attrs(st)}>Quiet</Button>],
  ['Ghost',st=><Button variant="ghost" {...attrs(st)} aria-expanded={st==='Selected'||undefined}>Data</Button>],
  ['Plain',st=><Button variant="plain" {...attrs(st)}>Title <Px icon={Pencil} size={14}/></Button>],
  ['Tile',st=><Button variant="tile" {...attrs(st)} className={st==='Selected'?'on':undefined}><b>Tile</b><span className="muted">Card you click</span></Button>],
  ['Google',st=><Button variant="google" {...attrs(st)}><span className="google-g-wrap"><span className="google-g" aria-hidden="true" style={{color:'#4285F4',font:'700 13px var(--fb)'}}>G</span></span>Google</Button>],
  ['Icon',st=><IconButton label="Edit" {...attrs(st)} icon={<Px icon={Pencil}/>}/>],
  ['Icon ghost',st=><IconButton variant="ghost" label="Edit" {...attrs(st)} aria-expanded={st==='Selected'||undefined} icon={<Px icon={Pencil}/>}/>],
  ['Star',st=><IconButton variant="star" label="Save to My sets" {...attrs(st)} aria-pressed={st==='Selected'} className={st==='Selected'?'on':undefined} icon={star}/>],
  ['Toggle',st=><Toggle on={st==='Selected'} onChange={()=>{}} {...attrs(st)}>Helping Hand</Toggle>],
  ['Mega',st=><Toggle variant="mega" on={st==='Selected'} onChange={()=>{}} {...attrs(st)}><MegaOrb size={14}/>Mega</Toggle>],
  ['Chip',st=><Chip on={st==='Selected'} {...attrs(st)}>Rain</Chip>],
  ['Tabs',st=><div className="tabs"><button className={st==='Selected'?'selected':''} {...attrs(st)}>Damage</button></div>],
  ['Tab links',st=><nav className="tabs nav"><a href="#design-system" className={st==='Selected'?'selected':''} aria-disabled={st==='Disabled'||undefined} {...(st==='Disabled'?{}:attrs(st))}>Strategy</a></nav>],
  ['Field',st=><input placeholder="Team name" {...attrs(st)} defaultValue={st==='Selected'?'Rain blitz':undefined}/>],
  ['Select',st=><select {...attrs(st)}><option>Reg M-C</option></select>],
  ['Switch',st=><Switch {...attrs(st)} checked={st==='Selected'} onChange={()=>{}}>Trick Room</Switch>],
];
function States(){return <div className="ds-states">{ROWS.map(([name,make])=><div key={name} className="ds-states-row"><span className="eyebrow">{name}</span>
  <div className="ds-states-cells">{STATES.filter(st=>st!=='Selected'||SELECTABLE.has(name)).map(st=><figure key={st}>{make(st)}<figcaption className="muted">{st==='Selected'&&(name==='Ghost'||name==='Icon ghost')?'Open':st}</figcaption></figure>)}</div></div>)}</div>;}

function Sheet(){
  const [seg,setSeg]=useState('all'),[tab,setTab]=useState('Damage'),[week,setWeek]=useState('0'),[back,setBack]=useState<string[]>(['Incineroar']),[on,setOn]=useState(true),[mode,setMode]=useState<'key'|'mcp'>('key');
  return <div className="ds-sheet">
    <Panel title="Buttons" kicker="Button · IconButton">
      <div className="button-row ds-row"><Button variant="primary" icon={<Px icon={Check}/>}>Save</Button><Button>Secondary</Button><Button variant="danger" icon={<Px icon={Trash}/>}>Delete</Button><Button variant="quiet">Quiet</Button><Button variant="ghost">Ghost</Button><LinkButton href="#design-system">Link</LinkButton></div>
      <div className="button-row ds-row"><Button variant="danger" solid>Delete team</Button><Button variant="plain">Plain title <Px icon={Pencil} size={14}/></Button></div>
      <div className="button-row ds-row"><Button size="compact">Compact</Button><Button variant="primary" size="compact">Compact primary</Button><Button disabled>Disabled</Button>
        <IconButton label="Edit" icon={<Px icon={Pencil}/>}/><IconButton variant="ghost" label="Edit" icon={<Px icon={Pencil}/>}/><IconButton variant="ghost" size="compact" label="Delete" icon={<Px icon={Trash} size={16}/>}/><span className="ds-badge-host"><IconButton label="Inbox, 3 waiting" icon={<Px icon={Plus}/>}/><CountBadge count={3}/></span></div>
    </Panel>
    <Panel title="Fields" kicker="Field · Select · Textarea">
      <div className="form-grid ds-fields"><Field label="Team name"><input placeholder="e.g. Rain blitz"/></Field>
        <Field label="Format"><select defaultValue="mc"><option value="mc">Champions VGC · Reg M-C</option></select></Field></div>
      <Field label="Notes"><textarea rows={2} placeholder="Lead, key move, what wins it."/></Field>
      <Checkbox defaultChecked>Show inferred fields</Checkbox>
      <fieldset><legend>Back ({back.length}/2)</legend><div className="choose-row">{['Incineroar','Gholdengo','Rillaboom'].map(m=><ChoiceChip key={m} checked={back.includes(m)} disabled={!back.includes(m)&&back.length>=2} onChange={c=>setBack(c?[...back,m]:back.filter(x=>x!==m))}>{m}</ChoiceChip>)}</div></fieldset>
    </Panel>
    <Panel title="Choices" kicker="Segmented · Tabs · Toggle · Chip · Switch">
      <div className="ds-row"><Segmented label="Result" value={seg} onChange={setSeg} options={[{value:'all',label:'All'},{value:'win',label:'Wins'},{value:'loss',label:'Losses'}]}/></div>
      <Tabs block tabs={['Damage','Speed']} value={tab} onChange={setTab}/>
      <Tabs block tabs={[{value:'0',label:'This week',sub:'In progress'},{value:'1',label:'Oct 5',sub:'Weekly digest'}]} value={week} onChange={setWeek}/>
      <div className="toggles ds-row"><Toggle on={on} onChange={setOn}>Helping Hand</Toggle><Toggle on={!on} onChange={v=>setOn(!v)}>Critical hit</Toggle></div>
      <div className="chip-row ds-row"><Chip on>Rain</Chip><Chip>Trick Room</Chip><ChipLabel small>Balance</ChipLabel><ChipLabel on>Gengar<IconButton className="chip-remove" label="Remove Gengar" icon={<Px icon={Close} size={12}/>}/></ChipLabel></div>
      <ModeSwitch label="Connect your AI" value={mode} onChange={setMode} options={[{value:'key',label:'API key',icon:<Px icon={Sparkles}/>},{value:'mcp',label:'MCP'}]}/>
    </Panel>
    <Panel title="Labels" kicker="Tag · Eyebrow · Footnote">
      <div className="ds-row"><Tag>Champions VGC · Reg M-C</Tag><Tag tone="ok">★ Exact spread</Tag><Tag tone="warn">Ends soon</Tag></div>
      <span className="eyebrow">Eyebrow</span><p className="footnote">Limitless · 12 Oct 2026 · 1,013 players</p><p className="error">Couldn’t save. Check your connection.</p>
    </Panel>
    <Panel title="Surfaces" kicker="Panel · Card · Notice · Empty · Toast">
      <Card><h3>Gholdengo</h3><p className="muted">Good as Gold · Timid</p></Card>
      <Notice>Regulation M-C ends on 1 December.</Notice>
      <Empty>Nothing here yet.</Empty>
      <div className="ds-toast"><Toast onDismiss={()=>{}}>Saved</Toast></div>
    </Panel>
    <Panel title="Dialog" kicker="Modal · ModalFooter">
      <div className="modal ds-dialog"><header><h2>Lead plan</h2><IconButton className="dialog-close" label="Close dialog" icon={<Px icon={Close} size={18}/>}/></header>
        <Field label="Title"><input placeholder="e.g. Rain blitz"/></Field>
        <ModalFooter><Button>Use MCP</Button><Button variant="primary">Save lead plan</Button></ModalFooter></div>
    </Panel>
    <Panel title="States" kicker="Default · Hover · Focus · Active · Disabled · Selected"><States/></Panel>
    <Panel title="Header and links" kicker="TabLinks · LinkButton · GoogleButton · Switch">
      <TabLinks nav items={[{key:'a',href:'#design-system',label:'Pokémon',selected:true},{key:'b',href:'#design-system',label:'Strategy',selected:false}]}/>
      <div className="button-row ds-row"><LinkButton href="#design-system" size="large">Large link</LinkButton><Button variant="primary" size="large">Large</Button><GoogleButton/></div>
      <div className="button-row ds-row"><Button variant="primary" size="hero">Hero</Button></div>
      <div className="ds-row"><Switch defaultChecked>Trick Room</Switch><input className="compact num" type="number" defaultValue={32} aria-label="Stat points" style={{width:56}}/></div>
    </Panel>
    <Panel title="Tokens" kicker="Spacing · Colour">
      <div className="ds-space">{SPACE.map(([n,px])=><div key={n}><i style={{width:px}}/><span>--{n} · {px}</span></div>)}</div>
      <div className="ds-colours">{COLOURS.map(c=><div key={c}><i style={{background:`var(--${c})`}}/><span>--{c}</span></div>)}</div>
    </Panel>
  </div>;
}

export default function DesignSystem(){
  return <div className="ds-page"><div className="landing-head"><h1>Design system</h1></div>
    <div className="ds-themes"><section data-theme="dark" aria-label="Dark theme"><span className="eyebrow">Dark</span><Sheet/></section>
      <section data-theme="light" aria-label="Light theme"><span className="eyebrow">Light</span><Sheet/></section></div></div>;
}
