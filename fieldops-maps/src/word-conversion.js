export const isWordDocument=file=>/\.docx?$/i.test(file.name);
// Release guard: the browser conversion engine must pass startup and layout checks.
export function startWordConversion(){
 throw Error('Word-to-PDF conversion is not available yet. Save the document as a PDF, then upload the PDF. Your Word file was not uploaded.');
}
