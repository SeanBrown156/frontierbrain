import {useState} from 'react';
import {Button,IconButton,Field,Tag,CountBadge,Toggle,Segmented,Card,Panel,Notice,Empty,Tabs,ModeSwitch,ModalFooter} from './ui.tsx';
import {Px,Plus,Pencil,Trash,Close,Check,Sparkles} from './icons.tsx';

// #design-system: every component in both themes, side by side (stacked on phones). Built only from ui.tsx components
// and their classes; the ds-* rules in jade.css just lay the specimens out.
const SPACE=[['s1',4],['s2',8],['s3',12],['s4',16],['s6',24],['s8',32],['s12',48]] as const;
const COLOURS=['bg','glass','sunk','tx','mu','ln','ac','gd','hot'];

function Sheet(){
  const [seg,setSeg]=useState('all'),[tab,setTab]=useState('Damage'),[on,setOn]=useState(true),[mode,setMode]=useState<'key'|'mcp'>('key');
  return <div className="ds-sheet">
    <Panel title="Buttons" kicker="Button · IconButton">
      <div className="button-row ds-row"><Button variant="primary" icon={<Px icon={Check}/>}>Save</Button><Button>Secondary</Button><Button variant="danger" icon={<Px icon={Trash}/>}>Delete</Button><Button variant="quiet">Quiet</Button></div>
      <div className="button-row ds-row"><Button size="compact">Compact</Button><Button variant="primary" size="compact">Compact primary</Button><Button disabled>Disabled</Button>
        <IconButton label="Edit" icon={<Px icon={Pencil}/>}/><span className="ds-badge-host"><IconButton label="Inbox, 3 waiting" icon={<Px icon={Plus}/>}/><CountBadge count={3}/></span></div>
    </Panel>
    <Panel title="Fields" kicker="Field · Select · Textarea">
      <div className="form-grid ds-fields"><Field label="Team name"><input placeholder="e.g. Rain blitz"/></Field>
        <Field label="Format"><select defaultValue="mc"><option value="mc">Champions VGC · Reg M-C</option></select></Field></div>
      <Field label="Notes"><textarea rows={2} placeholder="Lead, key move, what wins it."/></Field>
      <label className="radio"><input type="checkbox" defaultChecked/>Show inferred fields</label>
      <fieldset><legend>Back (1/2)</legend><div className="choose-row"><label className="choose on"><input type="checkbox" defaultChecked/>Incineroar</label><label className="choose"><input type="checkbox"/>Gholdengo</label></div></fieldset>
    </Panel>
    <Panel title="Choices" kicker="Segmented · Tabs · Toggle · Chip · Switch">
      <div className="ds-row"><Segmented label="Result" value={seg} onChange={setSeg} options={[{value:'all',label:'All'},{value:'win',label:'Wins'},{value:'loss',label:'Losses'}]}/></div>
      <Tabs tabs={['Damage','Speed']} value={tab} onChange={setTab}/>
      <div className="toggles ds-row"><Toggle on={on} onChange={setOn}>Helping Hand</Toggle><Toggle on={!on} onChange={v=>setOn(!v)}>Critical hit</Toggle></div>
      <div className="chip-row ds-row"><button className="chip on">Rain</button><button className="chip">Trick Room</button></div>
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
      <div className="toast ds-toast" role="status">Saved<button className="icon" aria-label="Dismiss notification"><Px icon={Close} size={16}/></button></div>
    </Panel>
    <Panel title="Dialog" kicker="Modal · ModalFooter">
      <div className="modal ds-dialog"><header><h2>Lead plan</h2><button className="icon dialog-close" aria-label="Close dialog"><Px icon={Close} size={18}/></button></header>
        <Field label="Title"><input placeholder="e.g. Rain blitz"/></Field>
        <ModalFooter><Button>Use MCP</Button><Button variant="primary">Save lead plan</Button></ModalFooter></div>
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
