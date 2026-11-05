using System;
using System.IO;
using System.Collections.Generic;
using System.Runtime.InteropServices.JavaScript;
using System.Text.Json;
using System.Linq;
using System.Text;
using System.Security.Cryptography;
using ACadSharp;
using ACadSharp.IO;
using ACadSharp.Entities;
using ACadSharp.Tables;
using ACadSharp.Blocks;
public partial class DwgConvert {
 public static void Main() { }
 public record ReferenceInput(string key, string data);
 public record ReferenceInfo(string key, string name, string path, string parent, bool overlay, bool unloaded, bool included, string issue);
 static CadDocument Read(byte[] bytes, HashSet<string> notices) {
  using var stream=new MemoryStream(bytes);
  return DwgReader.Read(stream,new DwgReaderConfiguration {Failsafe=false},(s,e)=>{if(notices.Count<100)notices.Add(e.Message);});
 }
 static bool IsReference(BlockRecord block)=>(block.Flags & (BlockTypeFlags.XRef|BlockTypeFlags.XRefOverlay))!=0;
 static IEnumerable<BlockRecord> UsedReferences(CadDocument document) {
  var seen=new HashSet<BlockRecord>();var result=new List<BlockRecord>();
  void Visit(IEnumerable<Entity> entities,int depth) {
   if(depth>64)throw new InvalidOperationException("Drawing blocks are nested too deeply.");
   foreach(var insert in entities.OfType<Insert>()) {
    if(insert.Block==null||!seen.Add(insert.Block))continue;
    if(IsReference(insert.Block))result.Add(insert.Block);else Visit(insert.Block.Entities,depth+1);
   }
  }
  Visit(document.Entities,0);return result;
 }
 static void Bind(CadDocument document,string[] chain,Dictionary<string,byte[]> files,HashSet<string> ancestors,List<ReferenceInfo> references,HashSet<string> notices) {
  foreach(var block in UsedReferences(document)) {
   if(references.Count>=100)throw new InvalidOperationException("A drawing can include up to 100 external references.");
   var names=chain.Append(block.Name).ToArray();var key=JsonSerializer.Serialize(names);
   var overlay=(block.Flags & BlockTypeFlags.XRefOverlay)!=0;
   var issue=chain.Length>0&&overlay?"Nested overlay (not carried into the parent drawing)":chain.Length>=8?"Reference nesting exceeds eight levels":"";
   CadDocument child=null;string hash=null;
   if(issue==""&&files.TryGetValue(key,out var bytes)) {
    hash=Convert.ToHexString(SHA256.HashData(bytes));
    if(ancestors.Contains(hash))issue="Circular reference skipped";
    else {
     child=Read(bytes,notices);
     var branch=new HashSet<string>(ancestors){hash};
     Bind(child,names,files,branch,references,notices);
    }
   }
   references.Add(new ReferenceInfo(key,block.Name,block.BlockEntity.XRefPath??"",string.Join(" / ",chain),overlay,block.IsUnloaded,child!=null,issue));
   // Always remove any cached xref geometry: unchecked references must not leak into the map.
   block.Entities.Clear();block.Flags &= ~(BlockTypeFlags.XRef|BlockTypeFlags.XRefOverlay|BlockTypeFlags.XRefDependent|BlockTypeFlags.XRefResolved|BlockTypeFlags.Referenced);
   block.BlockEntity.XRefPath="";block.IsUnloaded=false;
   if(child==null)continue;
   // Bind definitions, retaining the original INSERT transforms (including repeated inserts).
   // Namespaces prevent same-named layers/blocks in separate drawings from merging.
   var prefix=block.Name+"$0$";
   block.BlockEntity.BasePoint=child.Header.ModelSpaceInsertionBase;
   foreach(var entity in child.Entities) {
    var clone=(Entity)entity.Clone();Namespace(clone,prefix,new HashSet<TableEntry>());Register(clone,document,new HashSet<BlockRecord>());block.Entities.Add(clone);
   }
  }
 }
 // Rename detached clones; CAD protects default table entries such as layer 0 in a live document.
 static void Namespace(Entity entity,string prefix,HashSet<TableEntry> seen) {
  void Rename(TableEntry entry,bool lineType=false) {
   if(entry==null||!seen.Add(entry))return;
   if(lineType&&new[]{"BYLAYER","BYBLOCK","CONTINUOUS"}.Contains(entry.Name.ToUpperInvariant()))return;
   entry.Name=prefix+entry.Name;
  }
  // GDAL 3.8 otherwise applies the INSERT colour to ByLayer children during expansion.
  // Keep layer-0 and ByBlock inheritance; freeze named-layer colours before binding.
  if(entity.Color.IsByLayer&&entity.Layer.Name!="0"&&!entity.Layer.Name.EndsWith("$0$0",StringComparison.Ordinal))entity.Color=entity.Layer.Color;
  Rename(entity.Layer);Rename(entity.LineType,true);Rename(entity.Layer.LineType,true);
  if(entity is TextEntity text)Rename(text.Style);
  if(entity is MText mtext)Rename(mtext.Style);
  if(entity is Shape shape)Rename(shape.ShapeStyle);
  if(entity is Insert insert) {
   foreach(var attribute in insert.Attributes)Namespace(attribute,prefix,seen);
   if(insert.Block!=null&&!seen.Contains(insert.Block)) {
    Rename(insert.Block);Namespace(insert.Block.BlockEntity,prefix,seen);
    foreach(var nested in insert.Block.Entities)Namespace(nested,prefix,seen);
   }
  }
 }
 // Register bound definitions explicitly before the DXF TABLES section is written.
 static void Register(Entity entity,CadDocument document,HashSet<BlockRecord> seen) {
  entity.LineType=document.LineTypes.TryAdd(entity.LineType);
  entity.Layer.LineType=document.LineTypes.TryAdd(entity.Layer.LineType);
  entity.Layer=document.Layers.TryAdd(entity.Layer);
  if(entity is TextEntity text)text.Style=document.TextStyles.TryAdd(text.Style);
  if(entity is MText mtext)mtext.Style=document.TextStyles.TryAdd(mtext.Style);
  if(entity is Shape shape)shape.ShapeStyle=document.TextStyles.TryAdd(shape.ShapeStyle);
  if(entity is Insert insert) {
   foreach(var attribute in insert.Attributes)Register(attribute,document,seen);
   if(insert.Block!=null&&seen.Add(insert.Block)) {
    Register(insert.Block.BlockEntity,document,seen);
    foreach(var nested in insert.Block.Entities)Register(nested,document,seen);
    document.BlockRecords.TryAdd(insert.Block);
   }
  }
 }
 [JSExport]
 public static string ConvertDrawing(string input) => ConvertDrawingWithReferences(input,"[]");
 [JSExport]
 public static string ConvertDrawingWithReferences(string input,string referenceJSON) {
  Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
  var notices=new HashSet<string>();
  if(input.Length>70*1024*1024)throw new InvalidOperationException("DWG files must be 50 MB or smaller.");
  var bytes=Convert.FromBase64String(input);
  var files=(JsonSerializer.Deserialize<ReferenceInput[]>(referenceJSON)??Array.Empty<ReferenceInput>()).ToDictionary(r=>r.key,r=>Convert.FromBase64String(r.data));
  if(files.Count>100||files.Values.Sum(b=>(long)b.Length)+bytes.Length>300L*1024*1024)throw new InvalidOperationException("Import up to 300 MB including referenced drawings.");
  var document=Read(bytes,notices);var references=new List<ReferenceInfo>();
  Bind(document,Array.Empty<string>(),files,new HashSet<string>{Convert.ToHexString(SHA256.HashData(bytes))},references,notices);
  if(document.Entities.Count==0)throw new InvalidOperationException("This DWG contains no supported model-space entities. Export a 2D DXF from your CAD application.");
  using var output=new MemoryStream();
  DxfWriter.Write(output,document,notification:(s,e)=>{if(notices.Count<100)notices.Add(e.Message);});
  var dxf=output.ToArray();if(dxf.Length>100*1024*1024)throw new InvalidOperationException("The converted drawing is too large. Export a smaller area or fewer layers.");
  return JsonSerializer.Serialize(new {entityCount=document.Entities.Count,layers=document.Layers.Select(l=>l.Name).ToArray(),references,dxf=Convert.ToBase64String(dxf),warnings=notices});
 }
}
