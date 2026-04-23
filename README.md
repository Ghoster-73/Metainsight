# MetaInsight

MetaInsight is a cyber forensics web application for inspecting files, editing embedded metadata, encrypting selected content, decrypting generated blocks, and generating AI-assisted summaries. The project is built as a React frontend with an Express backend and MongoDB case storage.

## What it does

MetaInsight is designed around a simple workflow:

1. Upload a file
2. Let the backend analyze it
3. Review metadata
4. Encrypt or decrypt selected content
5. Generate AI summaries for text, code, or images
6. Save and reopen cases
7. Export rewritten files where supported

Supported file types include common text, code, PDF, and image formats like:

- `TXT`
- `JS`
- `TS`
- `JSX`
- `TSX`
- `PDF`
- `PNG`
- `JPG`
- `JPEG`

## What is working

- Backend server starts and responds correctly
- Frontend runs and builds correctly
- File upload works
- File analysis works
- MongoDB case storage works
- Metadata editing works inside the app
- Custom metadata fields can be added
- Selective encryption works
- Decryption works for MetaInsight encrypted blocks
- AI summary works for text and code
- OCR-style text extraction works for document-like images
- Rewrite export works for supported files

## What is partly working

- Image AI summary works best when OpenAI vision is available
- Metadata rewriting works for supported formats, but not every operating-system-level property can be truly rewritten
- Some Windows-style property fields are shown for reference only

## What is not fully working

- Live OpenAI image scene description depends on API quota and billing
- True OS-level properties like owner, permissions, and some timestamps cannot be controlled by a browser app
- Arbitrary fake file size cannot become the real byte size unless the file bytes actually match it

## Why those parts are limited

- OpenAI vision failures are usually account quota or billing issues, not a broken route
- Browser apps can embed metadata into files, but they cannot directly control every Windows property panel value
- Physical file size comes from the actual bytes in the file

## Requirements

- Node.js
- npm
- MongoDB for persistent case storage

Optional:

- OpenAI API key for live AI summaries

## Environment setup

### Backend

Create `backend/.env`:

```env
MONGO_URI=mongodb://127.0.0.1:27017/metainsight
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-4.1-mini
CLIENT_ORIGIN=http://localhost:5173
PORT=5000
```

### Frontend

Create `frontend/.env`:

```env
VITE_API_BASE_URL=http://localhost:5000
```

## Installation

Backend:

```powershell
cd "D:\Metainsight\backend"
npm install
```

Frontend:

```powershell
cd "D:\Metainsight\frontend"
npm install
```

## How to run

### Standard way

Backend:

```powershell
cd "D:\Metainsight\backend"
npm run dev
```

Frontend:

```powershell
cd "D:\Metainsight\frontend"
npm run dev
```

Then open:

```text
http://localhost:5173
```

### One-click way

Double-click:

`D:\Metainsight\Start-MetaInsight.bat`

It will:

- open the backend in one terminal window
- open the frontend in another terminal window
- open the app in your browser

## In short

MetaInsight is already usable as a working investigation workspace. The core upload, metadata, encryption, decryption, storage, and most AI-assisted flows are working. The biggest limitation right now is live image scene description when OpenAI vision is unavailable because of account quota.
