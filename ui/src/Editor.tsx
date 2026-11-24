// Monaco code editor bound to the open project file. Compile diagnostics appear as markers.
import { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import { get, send, set, useStore } from './store';

(self as any).MonacoEnvironment = { getWorker: () => new EditorWorker() };
const LANG: Record<string, string> = { java: 'java', kt: 'kotlin', xml: 'xml', json: 'json', gradle: 'groovy', md: 'markdown', properties: 'ini', yml: 'yaml', yaml: 'yaml' };

export function save() { const f = get().file; if (f) send({ type: 'saveFile', path: f.path, text: f.text }); }

export function Editor() {
  const host = useRef<HTMLDivElement>(null), editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const file = useStore((s) => s.file), compile = useStore((s) => s.compile);

  useEffect(() => {
    const ed = monaco.editor.create(host.current!, { theme: 'vs-dark', automaticLayout: true, fontSize: 12.5, minimap: { enabled: true }, scrollBeyondLastLine: false, tabSize: 4 });
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, save);
    ed.onDidChangeModelContent(() => { const f = get().file; if (f && ed.getValue() !== f.text) set({ file: { ...f, text: ed.getValue(), line: null } }); });
    editor.current = ed;
    return () => { ed.getModel()?.dispose(); ed.dispose(); };
  }, []);

  // one model per file path
  useEffect(() => {
    const ed = editor.current; if (!ed || !file) return;
    const uri = monaco.Uri.parse('project:///' + file.path.split('/').map(encodeURIComponent).join('/'));
    let model = monaco.editor.getModel(uri);
    if (!model) model = monaco.editor.createModel(file.text, LANG[file.path.split('.').pop()!.toLowerCase()] ?? 'plaintext', uri);
    if (ed.getModel() !== model) { const old = ed.getModel(); ed.setModel(model); if (old && old !== model) old.dispose(); }
    if (model.getValue() !== file.text) model.setValue(file.text);
  }, [file?.path, file?.saved]);

  useEffect(() => { // jump to a line (from the console, explorer or dependency view)
    const ed = editor.current; if (!ed || !file?.line) return;
    ed.revealLineInCenter(file.line); ed.setPosition({ lineNumber: file.line, column: 1 }); ed.focus();
  }, [file?.path, file?.line]);

  useEffect(() => { // compile diagnostics as squiggles
    const model = editor.current?.getModel(); if (!model || !file) return;
    const marks = (compile?.diagnostics ?? []).filter((d: any) => d.file === file.path && d.line).map((d: any) => ({
      severity: d.severity === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning, message: `[${d.category}] ${d.message}`,
      startLineNumber: d.line, endLineNumber: d.line, startColumn: model.getLineFirstNonWhitespaceColumn(Math.min(d.line, model.getLineCount())) || 1, endColumn: model.getLineMaxColumn(Math.min(d.line, model.getLineCount())) }));
    monaco.editor.setModelMarkers(model, 'javac', marks);
  }, [compile, file?.path, file?.saved]);

  return <div ref={host} className="fill" />;
}
