import {PDFDocument,PDFDict,PDFName,PDFTextField,PDFCheckBox,PDFRadioGroup,PDFDropdown,PDFOptionList,PDFSignature,PDFButton} from 'pdf-lib';
import {digest} from './document-signing-core.js';
async function loadTemplate(source){
 if(!source?.byteLength||source.byteLength>50*1024*1024)throw Error('Choose a PDF template up to 50 MB.');
 const doc=await PDFDocument.load(source,{updateMetadata:false});
 if(doc.context.enumerateIndirectObjects().some(([,obj])=>obj instanceof PDFDict&&(obj.get(PDFName.of('ByteRange'))||obj.get(PDFName.of('Type'))===PDFName.of('Sig'))))throw Error('A signed PDF cannot be used as a blank form template. Upload its unsigned original.');
 if(doc.catalog.lookupMaybe(PDFName.of('AcroForm'),PDFDict)?.has(PDFName.of('XFA')))throw Error('This PDF uses XFA forms. Export it as a standard PDF AcroForm before uploading.');
 const form=doc.getForm();return {doc,form};
}
function describe(field){
 const common={name:field.getName(),required:field.isRequired(),readOnly:field.isReadOnly()};
 if(field instanceof PDFTextField)return {...common,type:'text',value:field.getText()||'',multiline:field.isMultiline(),maxLength:field.getMaxLength()??null};
 if(field instanceof PDFCheckBox)return {...common,type:'checkbox',value:field.isChecked()};
 if(field instanceof PDFRadioGroup)return {...common,type:'radio',value:field.getSelected()||'',options:field.getOptions()};
 if(field instanceof PDFDropdown||field instanceof PDFOptionList)return {...common,type:'choice',value:field.getSelected(),options:field.getOptions(),multiple:field.isMultiselect(),editable:field instanceof PDFDropdown&&field.isEditable()};
 if(field instanceof PDFSignature||field instanceof PDFButton)return null;
 throw Error(`The field “${field.getName()}” is not supported.`);
}
export async function inspectFormTemplate(source){
 const {doc,form}=await loadTemplate(source),fields=form.getFields().map(describe).filter(Boolean);
 if(!fields.some(f=>!f.readOnly))throw Error('This PDF has no editable form fields. Upload a PDF with form fields already added.');
 return {fields,pageCount:doc.getPageCount(),templateHash:await digest(source)};
}
export async function fillFormTemplate({source,values}){
 const {doc,form}=await loadTemplate(source);if(!values||typeof values!=='object')throw Error('Complete the form first.');
 const fields=form.getFields();
 for(const field of fields){
  const info=describe(field);if(!info||info.readOnly)continue;
  const value=Object.hasOwn(values,info.name)?values[info.name]:info.value;
  if(info.required&&(value==null||value===false||typeof value==='string'&&!value.trim()||Array.isArray(value)&&!value.length))throw Error(`Complete the required field: ${info.name}`);
  if(info.type==='text'){
   if(typeof value!=='string'||info.maxLength&&value.length>info.maxLength)throw Error(`Check the text in ${info.name}.`);
   field.setText(value);
  }else if(info.type==='checkbox'){
   if(typeof value!=='boolean')throw Error(`Choose a value for ${info.name}.`);value?field.check():field.uncheck();
  }else if(info.type==='radio'){
   if(value==='')field.clear();else {if(!info.options.includes(value))throw Error(`Choose an option for ${info.name}.`);field.select(value);}
  }else{
   if(!Array.isArray(value)||!value.every(v=>typeof v==='string')||!info.multiple&&value.length>1||!info.editable&&value.some(v=>!info.options.includes(v)))throw Error(`Choose a valid option for ${info.name}.`);
   if(value.length)field.select(value);else field.clear();
  }
 }
 // Preserve the blank template; flatten only this completed copy before signing it.
 for(const field of fields)if(field instanceof PDFSignature||field instanceof PDFButton)form.removeField(field);
 try{form.flatten();}catch(error){throw Error('The template’s field appearance or font could not be filled. Check the PDF template. '+error.message);}
 const output=await doc.save();return {output,templateHash:await digest(source),outputHash:await digest(output)};
}
