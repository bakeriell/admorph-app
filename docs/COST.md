# API cost per Background Studio generation

Rough estimates based on [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing) (verify current rates).

## Models used

- **Image:** **Nano Banana Pro** (`gemini-3-pro-image`) — Gemini 3 Pro Image
- **Text / detection:** `gemini-3-flash-preview`

## Per Background Studio run (one “Generate New Background”)

| Step | API call | Approx. cost |
|------|----------|--------------|
| New background | 1× image generation | ~**$0.039** |
| Vehicle detection | 1× multimodal (image in, JSON out) | ~**$0.001–0.01** (token-based) |
| Car segmentation | 1× image generation | ~**$0.039** |
| **Total** | | **~$0.08–0.09** per generation |

- Image: **Nano Banana Pro (Gemini 3 Pro Image)** pricing may differ from older Flash image models; check [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing) for current per-image or per-token rates.
- Text/multimodal: Gemini Flash–style models are typically on the order of **$0.001–0.01** per request for this kind of call (input image + short JSON output).

Exact cost per generation depends on image size, output length, and current Google pricing. Check your Google AI / Vertex billing for Nano Banana Pro usage.

## Text Editor – cost per “generation”

Typical flow uses:

| Action | API call | Model | Approx. cost |
|--------|----------|--------|--------------|
| Detect text | detectText | gemini-3-flash-preview (text/multimodal) | ~$0.001–0.01 |
| Remove disclaimer | removeDisclaimer | Nano Banana Pro (image out) | ~1× image gen |
| Apply changes (replace text) | replaceText | Nano Banana Pro (image out) | ~1× image gen |
| Extract legal text | extractLegalText | gemini-3-flash-preview | ~$0.001–0.01 |

**One “Apply changes” (replace text) generation:**  
1× Nano Banana Pro image (**~one image gen**, e.g. in the **$0.04–0.10+** range depending on resolution and current Nano Banana Pro pricing) plus optional 1× text call for re-detecting text (~$0.001–0.01).

**Remove disclaimer (one shot):**  
1× Nano Banana Pro image — same ballpark as one image gen above.

Check [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing) and your billing for Nano Banana Pro (Gemini 3 Pro Image) per-image or per-token rates.

## Other flows

- **Format Converter** uses its own mix of image and text calls; cost will vary by action.
- Check [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing) and your Google Cloud/AI Studio billing for up-to-date numbers.
