"""Convert a STEP assembly to a binary glTF (GLB), keeping the assembly tree, part names and colours.

Usage: python step2glb.py input.step output.glb [linear_deflection_mm] [angular_deflection_rad] [zup|yup]

Geometry is tessellated by OpenCascade; nothing is redrawn or approximated beyond the
tessellation tolerance. Output is in metres, Y-up (glTF convention).
"""
import sys, time
from OCP.STEPCAFControl import STEPCAFControl_Reader
from OCP.TDocStd import TDocStd_Document
from OCP.TCollection import TCollection_ExtendedString, TCollection_AsciiString
from OCP.XCAFDoc import XCAFDoc_DocumentTool
from OCP.collections import Sequence_TDF_Label, IndexedDataMap_TCollection_AsciiString_TCollection_AsciiString
from OCP.IFSelect import IFSelect_RetDone
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.RWGltf import RWGltf_CafWriter
from OCP.RWMesh import RWMesh_CoordinateSystem_Zup, RWMesh_CoordinateSystem_Yup
from OCP.Message import Message_ProgressRange


def main():
    src, dst = sys.argv[1], sys.argv[2]
    lin = float(sys.argv[3]) if len(sys.argv) > 3 else 0.15
    ang = float(sys.argv[4]) if len(sys.argv) > 4 else 0.4
    t0 = time.time()
    doc = TDocStd_Document(TCollection_ExtendedString("ftcsim"))
    reader = STEPCAFControl_Reader()
    reader.SetNameMode(True)
    reader.SetColorMode(True)
    reader.SetLayerMode(False)
    if reader.ReadFile(src) != IFSelect_RetDone:
        sys.exit("STEP read failed")
    print(f"read STEP in {time.time() - t0:.0f}s", flush=True)
    if not reader.Transfer(doc):
        sys.exit("STEP transfer failed")
    print(f"transferred in {time.time() - t0:.0f}s", flush=True)

    shapes = XCAFDoc_DocumentTool.ShapeTool_s(doc.Main())
    free = Sequence_TDF_Label()
    shapes.GetFreeShapes(free)
    print("free shapes:", free.Length(), flush=True)
    for i in range(1, free.Length() + 1):
        shape = shapes.GetShape_s(free.Value(i))
        BRepMesh_IncrementalMesh(shape, lin, False, ang, True)
    print(f"meshed in {time.time() - t0:.0f}s", flush=True)

    writer = RWGltf_CafWriter(TCollection_AsciiString(dst), True)
    writer.SetMergeFaces(True)  # one mesh per part instead of one per CAD face (147k draw calls otherwise)
    conv = writer.ChangeCoordinateSystemConverter()
    conv.SetInputLengthUnit(0.001)
    up = sys.argv[5] if len(sys.argv) > 5 else 'zup'  # which axis is up in the source CAD
    conv.SetInputCoordinateSystem(RWMesh_CoordinateSystem_Yup if up == 'yup' else RWMesh_CoordinateSystem_Zup)
    ok = writer.Perform(doc, IndexedDataMap_TCollection_AsciiString_TCollection_AsciiString(), Message_ProgressRange())
    print(f"wrote {dst}: {ok} in {time.time() - t0:.0f}s", flush=True)
    if not ok:
        sys.exit("GLB write failed")


main()
