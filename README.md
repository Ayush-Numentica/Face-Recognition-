# Face Recognition App

A full-stack real-time face recognition application.

- **Backend** — Python · Flask · MTCNN · FaceNet (keras-facenet) · OpenCV
- **Frontend** — React · Axios · Web Speech API · Canvas overlay

---

## Features

| Feature | Details |
|---|---|
| Real-time detection | MTCNN detects faces every 1.5 s |
| Recognition | FaceNet 512-D embeddings + Euclidean distance |
| Voice output | Web Speech API speaks a custom greeting |
| Add person via UI | Upload photos **or** capture live from camera |
| Multi-image support | 3-5 images per person for better accuracy |
| Face log | Timestamped history of all recognitions |
| Custom messages | Per-person greeting, editable in the UI |
| Camera selector | Works with built-in & external USB cameras |

---

## Project Structure

```
FaceRecognition 2/
├── backend/
│   ├── dataset/              ← Put person folders here (auto-created)
│   │   └── Ayush/            ← Example: add img1.jpg, img2.jpg …
│   ├── embeddings/           ← Saved embeddings (auto-generated)
│   ├── models/               ← (reserved for future use)
│   ├── src/
│   │   ├── app.py            ← Flask REST API
│   │   ├── recognition.py    ← MTCNN + FaceNet engine
│   │   └── utils.py          ← Image helpers
│   ├── custom_messages.json  ← Editable greeting messages
│   └── requirements.txt
└── frontend/
    ├── public/
    │   └── index.html
    └── src/
        ├── components/
        │   ├── Camera.js       ← Video feed + bounding-box overlay
        │   ├── MessageBanner.js← Recognition result card
        │   ├── AddPerson.js    ← Register new person modal
        │   └── FaceLog.js      ← Recognition history table
        ├── App.js
        ├── App.css
        └── index.js
```

---

## Quick Start

### 1 — Backend

```bash
cd "FaceRecognition 2/backend"

# Create & activate a virtual environment (recommended)
python -m venv venv
# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Start the API server
python src/app.py
```

The API will be available at **http://localhost:5000**.

> On first run, keras-facenet downloads the pre-trained FaceNet weights
> automatically (~90 MB).  This happens once and is then cached.

---

### 2 — Frontend

Open a **second terminal**:

```bash
cd "FaceRecognition 2/frontend"

npm install      # installs React + Axios (one-time)
npm start        # starts dev server at http://localhost:3000
```

Open **http://localhost:3000** in Chrome/Edge.

---

## Adding People — Two Ways

### Option A — Via the UI (recommended)
1. Click the **Persons** tab → **+ Add Person**
2. Enter a name
3. Upload 3-5 photos **or** capture snapshots with your webcam
4. Click **Register**

### Option B — Via the filesystem
1. Create a folder: `backend/dataset/<Name>/`
2. Copy JPG/PNG images into it (3-5 recommended)
3. Call the rebuild endpoint:
   ```
   POST http://localhost:5000/rebuild-embeddings
   ```
   Or click **⟳ Rebuild All** in the Persons tab.

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Liveness check |
| POST | `/recognize` | Recognise face in image (JSON `{ image: base64 }`) |
| GET | `/persons` | List all registered persons |
| POST | `/add-person` | Add person (multipart: `name` + `images[]`) |
| DELETE | `/delete-person/<name>` | Remove a person |
| GET | `/custom-messages` | Get all greeting messages |
| POST | `/custom-messages` | Save greeting messages |
| GET | `/face-log` | Last 100 recognition events |
| POST | `/rebuild-embeddings` | Rebuild all embeddings from dataset |

---

## Tuning

| Parameter | File | Default | Effect |
|---|---|---|---|
| Recognition threshold | `backend/src/recognition.py` | `0.6` | Lower = stricter matching |
| Capture interval | `frontend/src/components/Camera.js` | `1500 ms` | Lower = more frequent checks |
| Speech cooldown | `frontend/src/App.js` | `10 000 ms` | Minimum gap between voice announcements |

---

## Troubleshooting

**"No face detected" for every frame**
→ Ensure adequate lighting.  MTCNN needs a reasonably clear face.

**Low confidence / wrong person**
→ Add more photos (different angles, lighting conditions).
→ Try lowering the threshold slightly (0.55).

**Backend not reachable from frontend**
→ Make sure both servers are running.  Check that nothing else uses port 5000.

**`keras_facenet` import error**
→ Ensure you are inside the virtual environment and ran `pip install -r requirements.txt`.

**Camera not showing**
→ Allow camera permission in the browser (padlock icon in address bar).

---

## Tech Stack

- **MTCNN** — Multi-task Cascaded Convolutional Networks for face detection
- **FaceNet** — Pre-trained model producing 512-D face embeddings (via keras-facenet)
- **Euclidean distance** — Similarity metric between embeddings
- **Web Speech API** — Browser-native text-to-speech (SpeechSynthesis)
- **React 18** — UI framework
- **Flask + flask-cors** — Lightweight Python REST API
