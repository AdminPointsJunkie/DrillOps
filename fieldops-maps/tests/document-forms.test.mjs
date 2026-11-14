import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument,PDFName} from 'pdf-lib';
import {inspectFormTemplate,fillFormTemplate} from '../src/document-forms-core.js';
import {digest,signDocument} from '../src/document-signing-core.js';

async function fixture(){
 const doc=await PDFDocument.create(),page=doc.addPage([595,842]),form=doc.getForm();
 const name=form.createTextField('Worker name');name.enableRequired();name.addToPage(page,{x:30,y:700,width:250,height:25});
 const notes=form.createTextField('Work details');notes.enableMultiline();notes.setMaxLength(200);notes.addToPage(page,{x:30,y:600,width:300,height:70});
 const check=form.createCheckBox('Area inspected');check.enableRequired();check.addToPage(page,{x:30,y:550,width:20,height:20});
 const radio=form.createRadioGroup('Condition');radio.addOptionToPage('Safe',page,{x:30,y:500,width:20,height:20});radio.addOptionToPage('Needs attention',page,{x:100,y:500,width:20,height:20});
 const choice=form.createDropdown('Shift');choice.addOptions(['Day','Night']);choice.addToPage(page,{x:30,y:450,width:160,height:25});
 const readonly=form.createTextField('Template revision');readonly.setText('Rev A');readonly.enableReadOnly();readonly.addToPage(page,{x:30,y:400,width:160,height:25});
 return doc.save();
}
const values={'Worker name':'Alex Example','Work details':'Checked the work area.\nNo hazards found.','Area inspected':true,'Condition':'Safe','Shift':['Day'],'Template revision':'malicious change'};
test('existing PDF fields are identified, filled and flattened in a new copy; blank template remains unchanged',async()=>{
 const source=await fixture(),before=await digest(source),info=await inspectFormTemplate(source);
 assert.equal(info.fields.length,6);assert.equal(info.fields.find(f=>f.name==='Area inspected').type,'checkbox');assert.equal(info.templateHash,before);
 const result=await fillFormTemplate({source,values}),output=await PDFDocument.load(result.output);
 assert.equal(output.getForm().getFields().length,0);assert.equal(output.getPageCount(),1);assert.equal(await digest(source),before);
 assert.equal((await PDFDocument.load(source)).getForm().getTextField('Worker name').getText(),undefined);
 const signed=await signDocument({source:result.output,method:'typed',name:'Alex Example',email:'fixture@example.invalid',pageIndex:0,x:30,y:250,text:'Alex Example'});
 assert.notEqual(signed.outputHash,result.outputHash);assert.equal((await PDFDocument.load(signed.output)).getForm().getFields().length,0);
});
test('required values, choice validation and maximum field length are enforced',async()=>{
 const source=await fixture();
 await assert.rejects(fillFormTemplate({source,values:{...values,'Worker name':''}}),/required field/);
 await assert.rejects(fillFormTemplate({source,values:{...values,'Area inspected':false}}),/required field/);
 await assert.rejects(fillFormTemplate({source,values:{...values,'Condition':'Unknown'}}),/Choose an option/);
 await assert.rejects(fillFormTemplate({source,values:{...values,'Shift':['Day','Night']}}),/valid option/);
 await assert.rejects(fillFormTemplate({source,values:{...values,'Work details':'x'.repeat(201)}}),/Check the text/);
});
test('PDFs without editable fields and XFA templates produce explicit errors',async()=>{
 const blank=await PDFDocument.create();blank.addPage();await assert.rejects(inspectFormTemplate(await blank.save()),/no editable form fields/);
 const xfa=await PDFDocument.load(await fixture());xfa.getForm().acroForm.dict.set(PDFName.of('XFA'),xfa.context.obj([]));
 await assert.rejects(inspectFormTemplate(await xfa.save({updateFieldAppearances:false})),/XFA/);
});
