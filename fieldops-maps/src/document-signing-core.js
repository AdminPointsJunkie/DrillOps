import {PDFDocument,PDFDict,PDFName,StandardFonts,rgb} from 'pdf-lib';
import {Buffer} from 'buffer';
globalThis.Buffer??=Buffer;
const bytes=value=>new Uint8Array(value);
export const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',value)),v=>v.toString(16).padStart(2,'0')).join('');
const ascii=value=>String(value||'').replace(/[‘’]/g,"'").replace(/[“”]/g,'"').replace(/[–—]/g,'-').replace(/[^\x20-\x7e]/g,'?');

export async function createSigningIdentity({name,email,password}){
 if(!name?.trim()||!email?.trim())throw Error('Your account needs a name and email address.');
 if(password.length<12)throw Error('Use a certificate password of at least 12 characters.');
 const {default:forge}=await import('node-forge');
 const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const der=value=>forge.asn1.fromDer(forge.util.createBuffer(Buffer.from(value).toString('binary')));
 const key=forge.pki.privateKeyFromAsn1(der(await crypto.subtle.exportKey('pkcs8',pair.privateKey)));
 const cert=forge.pki.createCertificate();cert.publicKey=forge.pki.publicKeyFromAsn1(der(await crypto.subtle.exportKey('spki',pair.publicKey)));
 cert.serialNumber='01'+Buffer.from(crypto.getRandomValues(new Uint8Array(19))).toString('hex');
 cert.validity.notBefore=new Date(Date.now()-60000);cert.validity.notAfter=new Date();cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear()+1);
 const subject=[{name:'commonName',value:name.trim()},{name:'emailAddress',value:email.trim()}];cert.setSubject(subject);cert.setIssuer(subject);
 cert.setExtensions([{name:'basicConstraints',cA:false},{name:'keyUsage',digitalSignature:true,nonRepudiation:true},{name:'subjectKeyIdentifier'}]);
 cert.sign(key,forge.md.sha256.create());
 const p12=forge.pkcs12.toPkcs12Asn1(key,[cert],password,{algorithm:'aes256',count:100000,friendlyName:'DrillOps FieldMaps · '+name});
 const certificate=Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(),'binary');
 return {p12:new Uint8Array(Buffer.from(forge.asn1.toDer(p12).getBytes(),'binary')),certificate:new Uint8Array(certificate),fingerprint:await digest(certificate),expires:cert.validity.notAfter.toISOString()};
}

export async function signDocument({source,method,name,email,pageIndex,x,y,text,png,p12,password,now=new Date().toISOString()}){
 if(!['typed','drawn','certificate'].includes(method))throw Error('Choose a signature method.');
 if(source.byteLength>50*1024*1024)throw Error('Signing supports PDFs up to 50 MB.');
 const doc=await PDFDocument.load(source,{updateMetadata:false});
 // Rewriting an existing certificate signature would invalidate it. Never do that silently.
 if(doc.context.enumerateIndirectObjects().some(([,obj])=>obj instanceof PDFDict&&(obj.get(PDFName.of('ByteRange'))||obj.get(PDFName.of('Type'))===PDFName.of('Sig'))))throw Error('This PDF already contains a certificate signature. Use a PDF signing tool that supports additional signatures; the existing signature has been left unchanged.');
 const page=doc.getPages()[pageIndex];if(!page)throw Error('Choose a page in this PDF.');
 let certificateFingerprint=null,certificateSubject=null,output;
 if(method==='certificate'){
  if(!p12?.byteLength||!password)throw Error('Choose your .p12/.pfx certificate and enter its password.');
  const {default:forge}=await import('node-forge');let store;
  try{store=forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(Buffer.from(p12).toString('binary')),false,password);}catch{throw Error('The certificate or password could not be read.');}
  const key=store.getBags({bagType:forge.pki.oids.pkcs8ShroudedKeyBag})[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0]?.key;
  const cert=store.getBags({bagType:forge.pki.oids.certBag})[forge.pki.oids.certBag]?.map(b=>b.cert).find(c=>key&&c.publicKey.n?.compareTo(key.n)===0&&c.publicKey.e?.compareTo(key.e)===0);
  if(!cert||!key)throw Error('Choose a password-protected RSA signing certificate.');
  const date=new Date(now);if(date<cert.validity.notBefore||date>cert.validity.notAfter)throw Error('This certificate is not currently valid.');
  const usage=cert.getExtension('keyUsage');if(usage&&!usage.digitalSignature&&!usage.nonRepudiation)throw Error('This certificate does not permit document signing.');
  certificateSubject=cert.subject.getField('CN')?.value||'Certificate signer';
  certificateFingerprint=await digest(Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(),'binary'));
 }
 const crop=page.getCropBox(),width=Math.min(250,crop.width-16),height=76;
 if(!Number.isFinite(x)||!Number.isFinite(y)||crop.height<height+16||width<80)throw Error('Choose a valid signature position.');
 x=Math.max(crop.x+8,Math.min(x,crop.x+crop.width-width-8));y=Math.max(crop.y+8,Math.min(y-height,crop.y+crop.height-height-8));
 const font=await doc.embedFont(StandardFonts.Helvetica),italic=await doc.embedFont(StandardFonts.TimesRomanItalic);
 page.drawRectangle({x,y,width,height,color:rgb(1,1,1),opacity:.94,borderColor:rgb(.7,.7,.7),borderWidth:.5});
 if(method==='drawn'){
  if(!png?.byteLength)throw Error('Draw your signature first.');const image=await doc.embedPng(png),ratio=Math.min((width-12)/image.width,40/image.height);
  page.drawImage(image,{x:x+6,y:y+30,width:image.width*ratio,height:image.height*ratio});
 }else{
  const value=ascii(method==='typed'?text:certificateSubject).trim();if(!value)throw Error('Enter your signature.');
  const size=Math.min(20,(width-12)/Math.max(1,italic.widthOfTextAtSize(value,1)));page.drawText(value,{x:x+6,y:y+44,font:italic,size});
 }
 const details=[ascii(name).slice(0,90),new Date(now).toISOString().replace('T',' ').slice(0,19)+' UTC',method==='certificate'?'Digital certificate - verify trust in your PDF reader':'Electronic signature - DrillOps FieldMaps'];
 details.forEach((line,i)=>page.drawText(line,{x:x+6,y:y+27-i*10,font,size:Math.min(7,(width-12)/Math.max(1,font.widthOfTextAtSize(line,1)))}));
 if(method==='certificate'){
  const date=new Date(now);
  const [{pdflibAddPlaceholder},{SignPdf},{P12Signer}]=await Promise.all([import('@signpdf/placeholder-pdf-lib'),import('@signpdf/signpdf'),import('@signpdf/signer-p12')]);
  pdflibAddPlaceholder({pdfDoc:doc,pdfPage:page,reason:'Supporting document signed in DrillOps FieldMaps',name:certificateSubject,contactInfo:email,location:'',signingTime:date,signatureLength:16384});
  output=bytes(await new SignPdf().sign(Buffer.from(await doc.save({useObjectStreams:false})),new P12Signer(Buffer.from(p12),{passphrase:password}),date));
 }else output=await doc.save();
 return {output,sourceHash:await digest(source),outputHash:await digest(output),certificateFingerprint,certificateSubject};
}
