"""Native PDF operations using permissively licensed PDFium, without Poppler."""
from io import BytesIO
from contextlib import closing

def text(source):
    import pypdfium2 as pdfium
    with closing(pdfium.PdfDocument(str(source))) as document:
        result=[]
        for index in range(len(document)):
            with closing(document[index]) as page, closing(page.get_textpage()) as textpage:
                result.append(textpage.get_text_bounded())
        return '\n'.join(result)

def pages(source):
    import pypdfium2 as pdfium
    with closing(pdfium.PdfDocument(str(source))) as document:return len(document)

def image(source, number):
    import pypdfium2 as pdfium
    with closing(pdfium.PdfDocument(str(source))) as document:
        if not 1<=number<=len(document):raise ValueError('页码超出文档范围')
        with closing(document[number-1]) as page:
            scale=1400/max(page.get_size())
            with closing(page.render(scale=scale)) as bitmap:
                output=BytesIO();bitmap.to_pil().save(output,format='PNG');return output.getvalue()
