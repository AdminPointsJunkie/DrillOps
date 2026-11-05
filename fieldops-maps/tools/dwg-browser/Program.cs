using System;
using System.IO;
using System.Collections.Generic;
using System.Runtime.InteropServices.JavaScript;
using System.Text.Json;
using System.Linq;
using System.Text;
using ACadSharp.IO;
public partial class DwgConvert {
 public static void Main() { }
 [JSExport]
 public static string ConvertDrawing(string input) {
  Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
  var notices=new HashSet<string>();
  if(input.Length>70*1024*1024)throw new InvalidOperationException("DWG files must be 50 MB or smaller.");
  using var source=new MemoryStream(Convert.FromBase64String(input));
  var document=DwgReader.Read(source,new DwgReaderConfiguration {Failsafe=false},(s,e)=>{if(notices.Count<100)notices.Add(e.Message);});
  if(document.Entities.Count==0)throw new InvalidOperationException("This DWG contains no supported model-space entities. Export a 2D DXF from your CAD application.");
  using var output=new MemoryStream();
  DxfWriter.Write(output,document,notification:(s,e)=>{if(notices.Count<100)notices.Add(e.Message);});
  var bytes=output.ToArray();
  if(bytes.Length>100*1024*1024)throw new InvalidOperationException("The converted drawing is too large. Export a smaller area or fewer layers.");
  return JsonSerializer.Serialize(new {entityCount=document.Entities.Count, layers=document.Layers.Select(l=>l.Name).ToArray(),dxf=Convert.ToBase64String(bytes),warnings=notices});
 }
}
