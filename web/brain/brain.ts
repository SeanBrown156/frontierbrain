// The Frontier Brain mark: a faceted emerald brain, built procedurally so it can breathe, twist and turn.
// Geometry: a subdivided icosahedron shaped into two hemispheres (longitudinal fissure, temporal lobe, folds, a
// cerebellum) plus a pointed stem, flat-shaded so every triangle reads as a cut facet. Material: emerald glass
// (transmission, clearcoat, high IOR) lit by a studio environment so the facets sparkle. Original artwork.
import * as THREE from 'three';
import {mergeVertices} from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface BrainOptions {detail?:number;transparent?:boolean;pixelRatio?:number;network?:boolean}
export interface Brain {renderer:THREE.WebGLRenderer;scene:THREE.Scene;camera:THREE.PerspectiveCamera;group:THREE.Group;
  set(state:Partial<BrainState>):void;frame(t:number):void;resize(w:number,h:number):void;dispose():void}
export interface BrainState {twist:number;breathe:number;yaw:number;pitch:number;spin:number}

// Smooth pseudo-noise from layered sines: deterministic, cheap enough to re-evaluate every frame.
const folds=(x:number,y:number,z:number,t:number)=>
  0.55*Math.sin(6.2*x+2.1*Math.sin(3.1*y+t*.6)+1.3)*Math.sin(5.4*y+1.7*Math.cos(2.6*z)-.4)
 +0.35*Math.sin(9.1*z+3.2*x-t*.4)*Math.cos(7.3*y-1.1*x)
 +0.25*Math.sin(11.5*x-4.7*z+2.2*y+t*.3);

// Radius of the brain along a unit direction d (x: front/back, y: up/down, z: left/right).
function shape(d:THREE.Vector3,t:number,breathe:number){
  // Side profile: front (+x) rounded frontal lobe, back (−x) occipital; temporal lobe hangs low in the front half,
  // the back of the underside tucks up over the cerebellum.
  let x=d.x*1.36,y=d.y*1.0,z=d.z*1.02;
  if(y<0){const front=Math.max(0,Math.min(1,(d.x+0.35)/0.7));y*=0.55+0.33*front;}
  if(y>0)y*=1-0.08*Math.max(0,-d.x);                                                   // slightly lower at the back
  const fissure=0.2*Math.exp(-(d.z*d.z)/0.008)*Math.max(0,d.y+0.05);                    // split between hemispheres
  const sulcus=0.13*Math.exp(-((d.y+0.05-0.38*d.x)**2)/0.006)*Math.max(0,1-Math.abs(d.x-0.05)*1.5)*Math.min(1,Math.abs(d.z)*2.2); // lateral sulcus
  const cereb=0.2*Math.exp(-(((d.x+0.72)**2)/0.045+((d.y+0.5)**2)/0.03+(d.z*d.z)/0.3));  // cerebellum at back-bottom
  const lobes=0.07*Math.sin(3.1*d.x+1.2)*Math.sin(2.7*d.y+0.6)+0.05*Math.sin(4.3*d.z*Math.sign(d.z)+2.4*d.x);
  const gyri=(0.075*folds(d.x,d.y,d.z,t)+lobes)*(0.75+0.35*breathe)*(d.y<-0.5?0.4:1);
  const r=1+gyri-fissure-sulcus+cereb+0.012*Math.sin(t*1.3)*breathe;
  return new THREE.Vector3(x*r,y*r,z*r);
}

// Reflections come from a dark emerald room with a few small bright panels: facets stay deep green and only flash
// white where they catch a panel, the way a cut stone does under shop lights.
function jewellersBox(){const box=new THREE.Scene();
  box.add(new THREE.Mesh(new THREE.BoxGeometry(12,12,12),new THREE.MeshBasicMaterial({color:0x03170c,side:THREE.BackSide})));
  const panel=(w:number,h:number,c:number,x:number,y:number,z:number)=>{const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({color:c,side:THREE.DoubleSide}));m.position.set(x,y,z);m.lookAt(0,0,0);box.add(m);};
  panel(3,1.2,0xffffff,2.5,4,3);panel(1.4,1.4,0xe8fff2,-4,2.5,2);panel(5,0.5,0x6dffb5,0,-3.5,4);panel(1,3,0xffffff,4.5,0,-2);panel(2,2,0x1fd08a,-3,-1,-4);panel(0.8,0.8,0xffffff,0,5,0.5);panel(0.6,2,0xffffff,-2,1,5);panel(2.5,0.4,0x9dffd0,3,-1,4.5);
  return box;}
export function createBrain(canvas:HTMLCanvasElement,{detail=3,transparent=true,pixelRatio=Math.min(2,globalThis.devicePixelRatio||1),network=false}:BrainOptions={}):Brain{
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:transparent,preserveDrawingBuffer:true});
  renderer.setPixelRatio(pixelRatio);renderer.toneMapping=THREE.NeutralToneMapping;renderer.toneMappingExposure=1.3;renderer.outputColorSpace=THREE.SRGBColorSpace;
  const scene=new THREE.Scene();const pmrem=new THREE.PMREMGenerator(renderer);scene.environment=pmrem.fromScene(jewellersBox(),0.02).texture;
  const camera=new THREE.PerspectiveCamera(30,1,0.1,50);camera.position.set(0,0.15,network?9.2:6.2);camera.lookAt(0,-0.05,0);

  // Base mesh: indexed so facets and edges share vertices; directions are kept to reshape every frame.
  const base=mergeVertices(new THREE.IcosahedronGeometry(1,detail).deleteAttribute('normal').deleteAttribute('uv'));
  const dirs=base.attributes.position.array as Float32Array;const index=base.index!.array;
  const n=dirs.length/3;const shaped=new Float32Array(dirs.length);
  const flat=new THREE.BufferGeometry();const flatPos=new Float32Array(index.length*3);flat.setAttribute('position',new THREE.BufferAttribute(flatPos,3));
  // Each facet gets its own depth of green, like a cut stone catching light differently on every face.
  const facet=new Float32Array(index.length*3);for(let f=0;f<index.length/3;f++){const r=Math.abs(Math.sin(f*12.9898+78.233)*43758.5453)%1;const bright=r>0.9;const k=bright?1.55:0.5+0.75*r,g=0.92+0.16*((r*7)%1);
    for(let j=0;j<3;j++){facet[(f*3+j)*3]=(bright?0.75:0.5)*k;facet[(f*3+j)*3+1]=g*k;facet[(f*3+j)*3+2]=(bright?0.85:0.68)*k;}}
  flat.setAttribute('color',new THREE.BufferAttribute(facet,3));
  // Facet edges: shared edges between faces that meet at a real angle, like the cut lines of a gem.
  const pairs:number[]=[];{const seen=new Map<string,number[]>();for(let f=0;f<index.length;f+=3)for(let k=0;k<3;k++){const a=index[f+k],b=index[f+(k+1)%3];const key=a<b?`${a}_${b}`:`${b}_${a}`;(seen.get(key)??seen.set(key,[]).get(key)!).push(f/3);}
    for(const [key,faces] of seen)if(faces.length===2&&(faces[0]*7+faces[1]*13)%3===0){const [a,b]=key.split('_').map(Number);pairs.push(a,b);}}
  const edgeGeo=new THREE.BufferGeometry();const edgePos=new Float32Array(pairs.length*3);edgeGeo.setAttribute('position',new THREE.BufferAttribute(edgePos,3));

  const emerald=new THREE.MeshPhysicalMaterial({color:0x0c9a49,emissive:0x03401f,emissiveIntensity:0.7,metalness:0.15,roughness:0.1,transmission:0,thickness:1.6,ior:1.58,vertexColors:true,
    clearcoat:1,clearcoatRoughness:0.03,specularIntensity:1,specularColor:new THREE.Color(0xc8ffe0),envMapIntensity:1.4,flatShading:true,attenuationColor:new THREE.Color(0x0a7a42),attenuationDistance:1.4});
  const body=new THREE.Mesh(flat,emerald);
  const core=new THREE.Mesh(flat,new THREE.MeshBasicMaterial({color:0x3dffa8,transparent:true,opacity:0.16,side:THREE.BackSide,blending:THREE.AdditiveBlending,depthWrite:false}));core.scale.setScalar(0.9);
  const edges=new THREE.LineSegments(edgeGeo,new THREE.LineBasicMaterial({color:0xd9ffec,transparent:true,opacity:0.18,blending:THREE.AdditiveBlending,depthWrite:false}));
  // The stem: a short faceted point under the brain, as in a cut gem.
  const stemGeo=new THREE.ConeGeometry(0.24,0.9,5,1).toNonIndexed();stemGeo.setAttribute('color',new THREE.BufferAttribute(new Float32Array(stemGeo.attributes.position.count*3).map((_,i)=>[0.5,0.95,0.65][i%3]*(0.7+0.3*((i/9|0)%3)/2)),3));stemGeo.computeVertexNormals();
  const stem=new THREE.Mesh(stemGeo,emerald);stem.position.set(-0.22,-0.78,0);stem.rotation.set(Math.PI,0.4,-0.22);
  // Sparkles: four-point stars that twinkle on the cut edges.
  const star=document.createElement('canvas');star.width=star.height=64;{const g=star.getContext('2d')!;const grd=g.createRadialGradient(32,32,0,32,32,32);grd.addColorStop(0,'rgba(255,255,255,1)');grd.addColorStop(0.15,'rgba(220,255,236,.9)');grd.addColorStop(1,'rgba(120,255,190,0)');
    g.fillStyle=grd;g.beginPath();g.moveTo(32,0);g.quadraticCurveTo(35,29,64,32);g.quadraticCurveTo(35,35,32,64);g.quadraticCurveTo(29,35,0,32);g.quadraticCurveTo(29,29,32,0);g.fill();}
  const starMat=new THREE.SpriteMaterial({map:new THREE.CanvasTexture(star),transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,depthTest:false});
  const sparkles=Array.from({length:12},(_,k)=>{const sp=new THREE.Sprite(starMat.clone());sp.userData={v:(k*97+13)%n,phase:k*1.7,speed:0.6+((k*37)%10)/12};return sp;});
  const group=new THREE.Group();group.add(body,core,edges,stem,...sparkles);scene.add(group);
  // The network: glowing nodes in a shell around the brain, wired to their neighbours and into the brain's surface,
  // with pulses of light running along the wires. It turns with the brain but drifts on its own too.
  const net=new THREE.Group();const pulses:THREE.Sprite[]=[];let wires:number[][]=[];const nodes:THREE.Vector3[]=[];
  if(network){const rnd=(k:number)=>Math.abs(Math.sin(k*91.7+3.1)*43758.5453)%1;
    for(let k=0;k<110;k++){const u=rnd(k)*2-1,a=rnd(k+500)*Math.PI*2,rad=1.75+rnd(k+900)*1.6;const q=Math.sqrt(1-u*u);nodes.push(new THREE.Vector3(q*Math.cos(a)*rad*1.35,u*rad*0.85,q*Math.sin(a)*rad));}
    for(let i=0;i<nodes.length;i++){const near=nodes.map((p,j)=>[p.distanceTo(nodes[i]),j]).sort((x,y)=>x[0]-y[0]).slice(1,4);for(const [d,j] of near)if(j>i&&d<1.6)wires.push([i,j]);}
    // A few wires reach into the brain itself.
    for(let k=0;k<26;k++){const i=(k*37)%nodes.length;wires.push([i,-1-((k*131)%n)]);}
    const pos=new Float32Array(wires.length*6);const wireGeo=new THREE.BufferGeometry();wireGeo.setAttribute('position',new THREE.BufferAttribute(pos,3));
    net.add(new THREE.LineSegments(wireGeo,new THREE.LineBasicMaterial({color:0x2bff95,transparent:true,opacity:0.22,blending:THREE.AdditiveBlending,depthWrite:false})));
    const dotGeo=new THREE.BufferGeometry().setFromPoints(nodes);const dot=document.createElement('canvas');dot.width=dot.height=32;{const g=dot.getContext('2d')!;const r=g.createRadialGradient(16,16,0,16,16,16);r.addColorStop(0,'rgba(220,255,236,1)');r.addColorStop(0.3,'rgba(80,255,170,.8)');r.addColorStop(1,'rgba(30,200,120,0)');g.fillStyle=r;g.fillRect(0,0,32,32);}
    net.add(new THREE.Points(dotGeo,new THREE.PointsMaterial({size:0.16,map:new THREE.CanvasTexture(dot),transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,sizeAttenuation:true})));
    for(let k=0;k<22;k++){const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(dot),transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,color:0xb8ffd9}));sp.scale.setScalar(0.14);sp.userData={w:(k*53)%wires.length,speed:0.25+((k*29)%10)/20,phase:k*0.37};pulses.push(sp);net.add(sp);}
    net.userData.update=(t:number)=>{const at=(i:number,out:THREE.Vector3)=>i>=0?out.copy(nodes[i]):out.set(shaped[(-1-i)*3],shaped[(-1-i)*3+1],shaped[(-1-i)*3+2]);const A=new THREE.Vector3(),B=new THREE.Vector3();
      wires.forEach(([i,j],k)=>{at(i,A);at(j,B);pos.set([A.x,A.y,A.z,B.x,B.y,B.z],k*6);});wireGeo.attributes.position.needsUpdate=true;
      for(const sp of pulses){const {w,speed,phase}=sp.userData;const f=((t*speed+phase)%1+1)%1;const [i,j]=wires[w as number];at(i,A);at(j,B);sp.position.lerpVectors(A,B,f);(sp.material as THREE.SpriteMaterial).opacity=Math.sin(f*Math.PI);}};
    group.add(net);}

  // Glints: small lights that drift across the facets.
  const key=new THREE.DirectionalLight(0xffffff,3.2);key.position.set(3,4,5);scene.add(key);
  const rim=new THREE.DirectionalLight(0x7dffc4,1.6);rim.position.set(-4,1,-3);scene.add(rim);
  const glint=new THREE.PointLight(0xffffff,14,8,2);scene.add(glint);
  const glow=new THREE.PointLight(0x2bff95,6,6,2);glow.position.set(0,0,0.2);scene.add(glow);

  const state:BrainState={twist:0,breathe:1,yaw:0,pitch:0,spin:0};const cur={...state};const v=new THREE.Vector3();
  const reshape=(t:number)=>{
    for(let i=0;i<n;i++){v.set(dirs[i*3],dirs[i*3+1],dirs[i*3+2]);const p=shape(v,t,cur.breathe);
      // Twist about the vertical axis, more at the top: the shape wrings like a towel when you hover.
      const a=cur.twist*(p.y+1)*0.55;const c=Math.cos(a),s=Math.sin(a);shaped[i*3]=p.x*c-p.z*s;shaped[i*3+1]=p.y;shaped[i*3+2]=p.x*s+p.z*c;}
    for(let k=0;k<index.length;k++){const i=index[k];flatPos[k*3]=shaped[i*3];flatPos[k*3+1]=shaped[i*3+1];flatPos[k*3+2]=shaped[i*3+2];}
    flat.attributes.position.needsUpdate=true;flat.computeVertexNormals();
    for(let k=0;k<pairs.length;k++){const i=pairs[k];edgePos[k*3]=shaped[i*3]*1.002;edgePos[k*3+1]=shaped[i*3+1]*1.002;edgePos[k*3+2]=shaped[i*3+2]*1.002;}
    edgeGeo.attributes.position.needsUpdate=true;};
  reshape(0);flat.computeBoundingSphere();edgeGeo.computeBoundingSphere();

  return {renderer,scene,camera,group,
    set(s){Object.assign(state,s);},
    frame(t){const ease=(k:keyof BrainState,r=0.08)=>{cur[k]+=(state[k]-cur[k])*r;};ease('twist',0.06);ease('breathe');ease('yaw',0.07);ease('pitch',0.07);ease('spin',0.05);
      reshape(t);if(network)net.userData.update(t);net.rotation.y=t*0.05;group.rotation.set(-0.12+cur.pitch,cur.yaw+cur.spin+Math.sin(t*0.35)*0.18-0.35,Math.sin(t*0.5)*0.03);group.position.y=Math.sin(t*0.9)*0.05*cur.breathe;
      glint.position.set(Math.sin(t*0.7)*3,1.4+Math.cos(t*0.5)*1.2,2.6);
      for(const sp of sparkles){const {v,phase,speed}=sp.userData;const i=v as number;sp.position.set(shaped[i*3]*1.03,shaped[i*3+1]*1.03,shaped[i*3+2]*1.03);const tw=Math.max(0,Math.sin(t*speed*1.6+phase));const sz=0.05+0.32*tw**6;sp.scale.set(sz,sz,1);(sp.material as THREE.SpriteMaterial).opacity=tw**3;}glow.intensity=5+Math.sin(t*1.7)*1.5;renderer.render(scene,camera);},
    resize(w,h){renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();},
    dispose(){renderer.dispose();pmrem.dispose();flat.dispose();edgeGeo.dispose();emerald.dispose();}};
}
