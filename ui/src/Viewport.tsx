// 3D field view. The viewer poses the official CAD from the latest physics snapshot every frame.
import { useEffect, useRef, useState } from 'react';
import { createViewer } from './viewer3d.js';
import { get, live, send, useStore } from './store';

const VIEWS = [['orbit', 'Orbit'], ['top', 'Top'], ['front', 'Front'], ['side', 'Side'], ['rear', 'Rear'], ['driver', 'Audience'], ['free', 'Free']];

export function Viewport({ visible }: { visible: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null), viewer = useRef<any>(null);
  const ready = useStore((s) => !!(s.assembly && s.robot && s.field)), modelOk = useStore((s) => !!s.assembly?.modelAvailable);
  const [view, setView] = useState('orbit'), [shapes, setShapes] = useState(false), [status, setStatus] = useState('');

  useEffect(() => {
    if (!ready || !modelOk || viewer.current) return;
    const s = get();
    const v = createViewer(canvas.current!, { assembly: s.assembly, robot: s.robot, field: s.field, fieldInfo: s.fieldInfo, onStatus: (t: string | null) => setStatus(t ?? '') });
    viewer.current = v; window.viewer3d = v;
    let raf = 0;
    const loop = () => { raf = requestAnimationFrame(loop); if (canvas.current!.offsetParent) v.update(live.snap); };
    loop();
    const onResize = () => v.resize();
    addEventListener('resize', onResize);
    const ro = new ResizeObserver(onResize); ro.observe(canvas.current!);
    return () => { cancelAnimationFrame(raf); removeEventListener('resize', onResize); ro.disconnect(); };
  }, [ready, modelOk]);
  useEffect(() => { if (visible) viewer.current?.resize(); }, [visible]);

  const down = useRef<[number, number] | null>(null);
  const onUp = (e: React.PointerEvent) => {
    const mode = get().placeMode, v = viewer.current;
    if (!down.current || !v || mode === 'off' || Math.hypot(e.clientX - down.current[0], e.clientY - down.current[1]) > 4) return; // a drag orbits the camera
    const hit = v.pick(e.nativeEvent);
    if (mode === 'remove') { if (hit.elementId) send({ type: 'elements', action: 'remove', id: hit.elementId }); }
    else if (hit.floor) send({ type: 'elements', action: 'spawn', elementType: mode, x: hit.floor.x, z: hit.floor.z });
  };

  return (
    <div className="fill viewport" style={{ display: visible ? undefined : 'none' }}>
      <canvas ref={canvas} onPointerDown={(e) => { down.current = [e.clientX, e.clientY]; }} onPointerUp={onUp} />
      {!modelOk && ready && <div className="empty">The robot CAD has not been converted yet. Run <code>npm run cad</code>, then reload.</div>}
      <div className="viewbar">
        {VIEWS.map(([id, label]) => <button key={id} className={view === id ? 'on' : ''} onClick={() => { setView(id); viewer.current?.setView(id); }}>{label}</button>)}
        <button className={shapes ? 'on' : ''} title="Overlay the simplified shapes the physics uses" onClick={() => { setShapes(!shapes); viewer.current?.showShapes(!shapes); }}>Shapes</button>
      </div>
      {status && <div className="cadstatus">{status}</div>}
    </div>
  );
}
