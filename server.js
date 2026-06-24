const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { PDFDocument } = require('pdf-lib');
const sharp = require('sharp');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const PORT = 5000;

// 1. COMPRESS PDF
app.post('/api/compress-pdf', upload.array('files'), async (req, res) => {
    try {
        const pdfDoc = await PDFDocument.load(req.files[0].buffer);
        // Basal structural minification (strip metadata variants)
        pdfDoc.setTitle('');
        pdfDoc.setCreator('');
        const compressedPdfBytes = await pdfDoc.save({ useObjectStreams: true });
        
        res.setHeader('Content-Type', 'application/pdf');
        res.send(Buffer.from(compressedPdfBytes));
    } catch (err) {
        res.status(500).send({ error: err.message });
    }
});

// 2. COMPRESS IMAGE
app.post('/api/compress-image', upload.array('files'), async (req, res) => {
    try {
        const compressedImageBuffer = await sharp(req.files[0].buffer)
            .jpeg({ quality: 60 }) // Balanced dynamic scaling output
            .toBuffer();

        res.setHeader('Content-Type', 'image/jpeg');
        res.send(compressedImageBuffer);
    } catch (err) {
        res.status(500).send({ error: err.message });
    }
});

// 3. SPLIT PDF (Extracts Page 1 for foundational functional demonstration)
app.post('/api/split-pdf', upload.array('files'), async (req, res) => {
    try {
        const srcPdfDoc = await PDFDocument.load(req.files[0].buffer);
        const newPdfDoc = await PDFDocument.create();
        
        if(srcPdfDoc.getPageCount() > 0) {
            const [copiedPage] = await newPdfDoc.copyPages(srcPdfDoc, [0]);
            newPdfDoc.addPage(copiedPage);
        }

        const splitPdfBytes = await newPdfDoc.save();
        res.setHeader('Content-Type', 'application/pdf');
        res.send(Buffer.from(splitPdfBytes));
    } catch (err) {
        res.status(500).send({ error: err.message });
    }
});

// 4. IMAGES TO PDF
app.post('/api/images-to-pdf', upload.array('files'), async (req, res) => {
    try {
        const pdfDoc = await PDFDocument.create();
        
        for(let file of req.files) {
            let imgBuffer = file.buffer;
            // Convert to clean standard JPEG layer
            if (file.mimetype !== 'image/jpeg') {
                imgBuffer = await sharp(file.buffer).jpeg().toBuffer();
            }
            const jpgImage = await pdfDoc.embedJpg(imgBuffer);
            const page = pdfDoc.addPage([jpgImage.width, jpgImage.height]);
            page.drawImage(jpgImage, { x: 0, y: 0, width: jpgImage.width, height: jpgImage.height });
        }

        const pdfBytes = await pdfDoc.save();
        res.setHeader('Content-Type', 'application/pdf');
        res.send(Buffer.from(pdfBytes));
    } catch (err) {
        res.status(500).send({ error: err.message });
    }
});

app.listen(PORT, () => console.log(`🚀 FileForge Backend actively polling on Port ${PORT}`));
