"""Measure solid volume, centroid and bounding box of every top-level part of a STEP assembly.

Usage: python step_volumes.py input.step output.json
Output is in the glTF model frame used by the simulator: metres, +X left, +Y up, +Z front
(STEP is millimetres, Z-up: x_model = x, y_model = z, z_model = -y).
"""
import sys, json, time
from OCP.STEPCAFControl import STEPCAFControl_Reader
from OCP.TDocStd import TDocStd_Document
from OCP.TCollection import TCollection_ExtendedString
from OCP.XCAFDoc import XCAFDoc_DocumentTool, XCAFDoc_ShapeTool
from OCP.collections import Sequence_TDF_Label
from OCP.IFSelect import IFSelect_RetDone
from OCP.GProp import GProp_GProps
from OCP.BRepGProp import BRepGProp
from OCP.Bnd import Bnd_Box
from OCP.BRepBndLib import BRepBndLib
from OCP.TDataStd import TDataStd_Name
from OCP.TDF import TDF_Label


def name_of(label):
    attr = TDataStd_Name()
    try:
        if label.FindAttribute(TDataStd_Name.GetID_s(), attr):
            return attr.Get().ToExtString()
    except Exception:
        pass
    return None


def main():
    src, dst = sys.argv[1], sys.argv[2]
    t0 = time.time()
    doc = TDocStd_Document(TCollection_ExtendedString("ftcsim"))
    reader = STEPCAFControl_Reader()
    reader.SetNameMode(True)
    if reader.ReadFile(src) != IFSelect_RetDone:
        sys.exit("STEP read failed")
    reader.Transfer(doc)
    print(f"loaded in {time.time() - t0:.0f}s", flush=True)
    tool = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
    free = Sequence_TDF_Label()
    tool.GetFreeShapes(free)
    comps = Sequence_TDF_Label()
    XCAFDoc_ShapeTool.GetComponents_s(free.Value(1), comps, False)
    m = lambda x, y, z: [x / 1000.0, z / 1000.0, -y / 1000.0]
    parts = []
    for i in range(1, comps.Length() + 1):
        lab = comps.Value(i)
        shape = XCAFDoc_ShapeTool.GetShape_s(lab)
        ref = TDF_Label()
        ref_name = name_of(ref) if XCAFDoc_ShapeTool.GetReferredShape_s(lab, ref) else None
        props = GProp_GProps()
        BRepGProp.VolumeProperties_s(shape, props)
        c = props.CentreOfMass()
        box = Bnd_Box()
        BRepBndLib.Add_s(shape, box)
        lo, hi = box.CornerMin(), box.CornerMax()
        x0, y0, z0, x1, y1, z1 = lo.X(), lo.Y(), lo.Z(), hi.X(), hi.Y(), hi.Z()
        parts.append({"index": i - 1, "instance": name_of(lab), "product": ref_name,
                      "volumeM3": abs(props.Mass()) * 1e-9, "centroid": m(c.X(), c.Y(), c.Z()),
                      "boxMin": [x0 / 1000, z0 / 1000, -y1 / 1000], "boxMax": [x1 / 1000, z1 / 1000, -y0 / 1000]})
    json.dump({"source": src.split("/")[-1], "frame": "+X left, +Y up, +Z front, metres", "parts": parts}, open(dst, "w"), indent=1)
    print(f"wrote {len(parts)} parts in {time.time() - t0:.0f}s", flush=True)


main()
