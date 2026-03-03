import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";
import { TextBlock } from '../types';
import { getGeminiApiKey } from '../config';

/** Image gen: gemini-2.5-flash-image (works with Gemini API). Nano Banana Pro (gemini-3-pro-image) not yet available for generateContent in v1beta. */
const IMAGE_MODEL_NAME = 'gemini-2.5-flash-image';

const TEXT_MODEL_NAME = 'gemini-3-flash-preview';

export interface DetectedElement {
  label: string;
  box_2d: number[]; // [ymin, xmin, ymax, xmax] 0-1000
}

const getAI = () => {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error("Gemini API key is not set. Please set VITE_GEMINI_API_KEY in your environment (e.g. Vercel project settings).");
  }
  return new GoogleGenAI({ apiKey });
};

export const extractLegalText = async (
  imageBase64: string,
  mimeType: string
): Promise<string> => {
  const ai = getAI();
  
  try {
    const cleanBase64 = imageBase64.split(',')[1] || imageBase64;
    
    const response = await ai.models.generateContent({
      model: TEXT_MODEL_NAME,
      contents: {
        parts: [
          {
            text: "Extract any legal disclaimers, terms and conditions, fine print, or footnotes found at the bottom of this advertisement image. Return ONLY the extracted text. If no such text exists, return an empty string.",
          },
          {
            inlineData: {
              data: cleanBase64,
              mimeType: mimeType,
            },
          },
        ],
      },
      config: {
        // thinkingConfig is only for Gemini 3 series
      }
    });

    return response.text?.trim() || "";
  } catch (error) {
    console.warn("Failed to extract text:", error);
    return "";
  }
};

export const detectMovableElements = async (
  imageBase64: string,
  mimeType: string
): Promise<DetectedElement[]> => {
  const ai = getAI();

  try {
    const cleanBase64 = imageBase64.split(',')[1] || imageBase64;

    const prompt = `
      Analyze this advertisement image and detect the bounding boxes of semantic foreground groups.
      
      CRITICAL - GROUPING STRATEGY:
      Do not fragment objects. You must GROUP related visual components into single, cohesive bounding boxes.
      
      Specific Grouping Rules:
      1. **Logos**: Box must include BOTH the graphic icon AND the brand text/name next to it. Do not split them.
      2. **Text Blocks**: Group the Headline, Subheadline, and price together if they are stacked visually. Do not separate lines of text if they form one message.
      3. **Badges/Stickers**: Group the background shape (circle/star/ribbon) AND the text inside it into one single box.
      4. **CTA Buttons**: Group the button shape and the text inside it.
      5. **Product**: Box the whole product as one unit.
      
      Avoid returning tiny boxes for individual words or letters. Return fewer, larger, meaningful blocks that a user would want to move as a unit.
      
      Return a JSON array of objects.
      Schema:
      [
        {
          "label": "string (e.g., 'Logo Group', 'Text Block', 'Product')",
          "box_2d": [ymin, xmin, ymax, xmax] 
        }
      ]
      
      Coordinates must be normalized to a 0-1000 scale.
      Return ONLY valid JSON. Do not include markdown formatting.
    `;

    const response = await ai.models.generateContent({
      model: TEXT_MODEL_NAME, // Using Flash for multimodal understanding
      contents: {
        parts: [
          { text: prompt },
          { inlineData: { data: cleanBase64, mimeType } }
        ]
      },
      config: {
        responseMimeType: "application/json",
      }
    });

    const text = response.text || "[]";
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    
    if (start === -1 || end === -1) {
        return [];
    }

    const jsonStr = text.substring(start, end + 1);
    
    return JSON.parse(jsonStr) as DetectedElement[];
  } catch (error) {
    console.error("Failed to detect elements:", error);
    return [];
  }
};

export const generateFormatConversion = async (
  imageBase64: string,
  mimeType: string,
  targetRatio: string,
  additionalInstructions: string = ""
): Promise<string> => {
  const ai = getAI();

  try {
    const cleanBase64 = imageBase64.split(',')[1] || imageBase64;

    let layoutPrompt = "";
    
    switch (targetRatio) {
        case '9:16':
            layoutPrompt = `
              TRANSFORMATION TARGET: Vertical 9:16 Story Format. Fill the frame; avoid large empty areas.
              LAYOUT STRATEGY:
              - **Fill the frame**: Scale and position the main subject (vehicle/product) and all ad copy so the composition uses the full vertical space. Do not leave big empty bands at top or bottom. The subject and headline/CTA should feel intentionally placed, not floating in the middle with empty space above and below.
              - **Vertical balance**: Extend the background (floor, sky, road, environment) naturally up and down to fill 9:16. Keep the main subject and key text in the central 60–70% of the frame so the ad feels full and intentional. If the original has a headline, subhead, or CTA, reposition them to sit close to the subject or in a compact block (e.g. lower third) so there is minimal wasted space.
              - **Text Safe Zone**: Reserve only the bottom 10–15% as a clean, uncluttered strip (simple texture or shadow) for legal disclaimers. The rest of the frame should feel filled with the ad content.
            `;
            break;
        case '16:9':
            layoutPrompt = `
              TRANSFORMATION TARGET: Horizontal 16:9 Landscape Format.
              LAYOUT STRATEGY:
              - **Horizontal Expansion**: The canvas is getting wider.
              - **Action**: Center the main content horizontally. Extend the background environment (walls, scenery, horizon) to the left and right to fill the new space.
              - **Text Safe Zone**: CRITICAL: Generate a clean, uncluttered area at the BOTTOM of the frame (approx bottom 15%) or on the sides. This negative space (e.g., simple road surface, dark shadow, or blur) is REQUIRED for overlaying legal disclaimers. Do not fill every pixel with complex detail; leave breathing room.
            `;
            break;
        case '1:1':
            layoutPrompt = `
              TRANSFORMATION TARGET: Square 1:1 Format.
              LAYOUT STRATEGY:
              - **Balanced Square**: Ensure the content fits perfectly within a square frame.
              - **Action**: If original is landscape, extend vertical space. If original is portrait, extend horizontal space. Center the subject.
              - **Text Safe Zone**: Ensure the bottom edge has some breathing room (negative space) for small legal text if needed.
            `;
            break;
        default:
            layoutPrompt = `TRANSFORMATION TARGET: ${targetRatio} Format.`;
    }

    const prompt = `
      Reshape and adapt this advertisement creative into a high-quality ${targetRatio} format.
      ${targetRatio === '9:16' ? 'For story format: use the full frame; position subject and text so the layout feels full with minimal empty space.' : ''}

      ${layoutPrompt}

      CRITICAL - STYLE & OUTPAINTING CONSISTENCY:
      1. **Seamless Extension**: The new outer areas MUST be indistinguishable from the original image. 
         - Analyze the ISO grain, noise levels, and color grading of the original photo and REPLICATE it in the extended areas.
         - Avoid the \"AI smooth\" look. If the original is grainy, the extension must be grainy.
      2. **Context Continuation**: 
         - If there are lines (roads, buildings, tables), continue them perfectly in perspective.
         - If the background is a gradient or abstract pattern, extend it naturally.
      3. **No Hallucinations**: Do not add random objects (people, animals, trash cans) in the expanded areas unless necessary for realism. Keep it clean.

      CRITICAL - CONTENT PRESERVATION:
      1. **Text & Logos**: All primary text, headlines, and logos MUST be preserved and legible.
         - **License Plates & Emblems**: The text/numbers on vehicle license plates and the car manufacturer logo/badge MUST be preserved pixel-perfect. Do not blur, warp, or 'AI-hallucinate' new text.
      2. **Subject Integrity**: The main product/vehicle/subject must remain undistorted and sharp.

      MANDATORY CLEANUP:
      1. **Remove Legal/Fine Print**: Detect and ERASE small legal text at the bottom/edges to declutter the new layout. (We will re-add it manually in the safe zone created).

      ${additionalInstructions}
    `;

    const response = await ai.models.generateContent({
      model: IMAGE_MODEL_NAME,
      contents: {
        parts: [
          { text: prompt },
          { inlineData: { data: cleanBase64, mimeType: mimeType } },
        ],
      },
      config: {
        temperature: 0.4,
        imageConfig: {
          aspectRatio: targetRatio as any
        }
      }
    });

    let imageBase64Result: string | undefined;
    let textResponse: string | undefined;

    if (response.candidates && response.candidates[0].content && response.candidates[0].content.parts) {
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData && part.inlineData.data) {
           imageBase64Result = `data:image/png;base64,${part.inlineData.data}`;
        } else if (part.text) {
           textResponse = part.text;
        }
      }
    }

    if (imageBase64Result) {
      return imageBase64Result;
    }

    console.warn("Gemini Text Response:", textResponse);
    throw new Error(textResponse || "No image data found in response.");

  } catch (error) {
    console.error("Gemini API Error:", error);
    throw error;
  }
};

export const segmentElement = async (
    cropBase64: string,
    mimeType: string,
    elementLabel: string
  ): Promise<string> => {
    const ai = getAI();
    
    try {
      const cleanBase64 = cropBase64.split(',')[1] || cropBase64;
      
      const prompt = `
        Edit this image crop.
        TASK: Isolate the **${elementLabel}** only. Everything that is NOT the ${elementLabel} must become one flat color.
        
        INSTRUCTIONS:
        1. Keep the ${elementLabel} exactly as it is (pixels, colors, lighting). Do not change the object itself.
        2. Replace the ENTIRE background (sky, ground, anything behind or beside the ${elementLabel}) with a single flat color: pure magenta RGB(255,0,255) or #FF00FF. No gradients, no shadows, no variation—only solid flat magenta outside the ${elementLabel}.
        3. Edges of the ${elementLabel} must be sharp and clean against the magenta. Do not leave any non-magenta background pixels.
      `;
  
      const response = await ai.models.generateContent({
        model: IMAGE_MODEL_NAME,
        contents: {
          parts: [
            { text: prompt },
            { inlineData: { data: cleanBase64, mimeType } }
          ]
        },
        config: {
            temperature: 0.2
            // imageSize is only for Pro models
        }
      });
  
      let imageBase64Result: string | undefined;
  
      if (response.candidates && response.candidates[0].content && response.candidates[0].content.parts) {
        for (const part of response.candidates[0].content.parts) {
          if (part.inlineData && part.inlineData.data) {
             imageBase64Result = `data:image/png;base64,${part.inlineData.data}`;
          }
        }
      }
  
      if (imageBase64Result) {
        return imageBase64Result;
      }
      
      throw new Error("Failed to segment element.");
  
    } catch (error) {
      console.error("Gemini API Error (Segmentation):", error);
      throw error;
    }
  };

export const removeObjectFromImage = async (
    imageBase64: string,
    mimeType: string,
    box_2d: number[],
    elementLabel: string = "object"
): Promise<string> => {
    const ai = getAI();
    try {
        const cleanBase64 = imageBase64.split(',')[1] || imageBase64;
        
        const prompt = `
            Edit this image by removing a specific element.
            
            INSTRUCTIONS:
            1. Identify the **${elementLabel}** located at coordinates [${box_2d.join(', ')}].
            2. **INPAINT**: Completely remove (ERASE) this element from the image. 
               - The goal is to make it disappear completely.
               - DO NOT leave any ghost, shadow, or remnant of the text/object.
            3. Fill the empty space seamlessly with the surrounding background texture, lighting, and patterns. 
            4. The result should look as if the object was never there.
        `;

        const response = await ai.models.generateContent({
            model: IMAGE_MODEL_NAME,
            contents: {
                parts: [
                    { text: prompt },
                    { inlineData: { data: cleanBase64, mimeType } }
                ]
            },
          config: {
                temperature: 0.3
                // imageSize is only for Pro models
            }
        });

        let imageBase64Result: string | undefined;
        let textResponse: string | undefined;

        if (response.candidates && response.candidates[0].content && response.candidates[0].content.parts) {
            for (const part of response.candidates[0].content.parts) {
                if (part.inlineData && part.inlineData.data) {
                    imageBase64Result = `data:image/png;base64,${part.inlineData.data}`;
                } else if (part.text) {
                    textResponse = part.text;
                }
            }
        }

        if (imageBase64Result) {
            return imageBase64Result;
        }

        throw new Error(textResponse || "Failed to remove object.");

    } catch (error) {
        console.error("Gemini API Error (Remove):", error);
        throw error;
    }
}

export const repositionContent = async (
    imageBase64: string,
    mimeType: string,
    sourceBox: number[],
    targetBox: number[],
    elementLabel?: string
  ): Promise<string> => {
    const ai = getAI();
  
    try {
      const cleanBase64 = imageBase64.split(',')[1] || imageBase64;
      
      const elementDesc = elementLabel || "visual element (text or logo)";
  
      const prompt = `
        Edit this image by moving a specific element.
        
        INSTRUCTIONS:
        1. Identify the **${elementDesc}** located in the SOURCE REGION: [${sourceBox.join(', ')}].
        2. Move this exact element to the TARGET REGION: [${targetBox.join(', ')}].
        3. **Inpainting**: Completely remove the ${elementDesc} from the original source region. Fill the hole seamlessly with the surrounding background texture/lighting so it looks like it was never there.
        4. **Compositing**: Place the ${elementDesc} in the target region. Blend it naturally (match lighting/shadows if needed) so it looks grounded.
        5. **Preservation**: Do not change any other part of the image. The vehicle and other key elements must remain identical.
      `;
  
      const response = await ai.models.generateContent({
        model: IMAGE_MODEL_NAME,
        contents: {
          parts: [
            { text: prompt },
            { inlineData: { data: cleanBase64, mimeType: mimeType } },
          ],
        },
        config: {
            temperature: 0.3
            // imageSize is only for Pro models
        }
      });
  
      let imageBase64Result: string | undefined;
      let textResponse: string | undefined;
  
      if (response.candidates && response.candidates[0].content && response.candidates[0].content.parts) {
        for (const part of response.candidates[0].content.parts) {
          if (part.inlineData && part.inlineData.data) {
             imageBase64Result = `data:image/png;base64,${part.inlineData.data}`;
          } else if (part.text) {
             textResponse = part.text;
          }
        }
      }
  
      if (imageBase64Result) {
        return imageBase64Result;
      }
      
      throw new Error(textResponse || "Failed to reposition content.");
  
    } catch (error) {
      console.error("Gemini API Error (Reposition):", error);
      throw error;
    }
  };

export const replaceBackground = async (
  imageBase64: string,
  mimeType: string,
  backgroundPrompt: string
): Promise<string> => {
  const ai = getAI();

  try {
    const cleanBase64 = imageBase64.split(',')[1] || imageBase64;

    const prompt = `
      Edit this image to replace the background with a new scene. The result must look like one single, natural photograph—not a cut-out or paste.

      TARGET BACKGROUND:
      ${backgroundPrompt}

      SUBJECT (CAR/VEHICLE):
      - Keep the car in the same position, orientation, scale, and perspective. Preserve license plate, logos, and the car's details exactly as is.
      - Do not add any outline, halo, glow, or colored edge around the car. No magenta, pink, or visible seam. The boundary between the car and the new background must be seamless and photorealistic.
      - Adjust the lighting and shading on the car to match the new background. Add realistic contact shadows or reflections where the car meets the ground.

      TEXT IN THE IMAGE:
      - KEEP all main ad copy: headlines, slogans, brand name, model name, price, offer text (e.g. "79€ al mese"), and any other visible marketing text. Do not remove or change these.
      - REMOVE ONLY the small disclaimer/legal/fine-print text: the tiny text at the very bottom or edges (terms and conditions, asterisk footnotes, "Offer valid until...", etc.). Erase only those small lines and fill that area seamlessly with the new background. All other text must remain.

      OUTPUT:
      One coherent image: new background, car naturally integrated, all main text kept, only the small legal/disclaimer text at the bottom or edges removed.
    `;

    const response = await ai.models.generateContent({
      model: IMAGE_MODEL_NAME,
      contents: {
        parts: [
          { text: prompt },
          { inlineData: { data: cleanBase64, mimeType: mimeType } },
        ],
      },
      config: {
        temperature: 0.3
        // imageSize is only for Pro models
      }
    });

    let imageBase64Result: string | undefined;
    let textResponse: string | undefined;

    if (response.candidates && response.candidates[0].content && response.candidates[0].content.parts) {
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData && part.inlineData.data) {
           imageBase64Result = `data:image/png;base64,${part.inlineData.data}`;
        } else if (part.text) {
           textResponse = part.text;
        }
      }
    }

    if (imageBase64Result) {
      return imageBase64Result;
    }
    
    throw new Error(textResponse || "Failed to generate background replacement.");

  } catch (error) {
    console.error("Gemini API Error (Background):", error);
    throw error;
  }
};

export const swapVehicle = async (
  baseImageBase64: string,
  baseMimeType: string,
  refImageBase64: string,
  refMimeType: string
): Promise<string> => {
  const ai = getAI();

  try {
    const cleanBase = baseImageBase64.split(',')[1] || baseImageBase64;
    const cleanRef = refImageBase64.split(',')[1] || refImageBase64;

    const prompt = `
      Image Editing Task: Vehicle Swap.
      
      INPUTS:
      1. First Image: The **Base Scene**.
      2. Second Image: The **Reference Vehicle**.
      
      GOAL:
      Replace the car in the Base Scene with the car from the Reference Vehicle.
      
      CRITICAL INSTRUCTIONS:
      1. **Scene Preservation**: Keep the Base Scene (background, road, sky, text, logos on the wall) EXACTLY as is. Do not change the environment.
      2. **Vehicle Replacement**: Remove the original car from the Base Scene. Insert the Reference Vehicle in its place.
      3. **Pose Adaptation**: The Reference Vehicle MUST be transformed (rotated, scaled, perspective-warped) to match the **exact orientation and footprint** of the original car in the Base Scene.
         - If the original car is facing left, the new car must face left.
         - The wheels should align with the ground plane correctly.
      4. **Lighting & Integration**:
         - Apply the lighting environment of the Base Scene to the Reference Vehicle.
         - Generate realistic cast shadows on the ground matching the scene's light source.
         - Generate reflections on the new car's body that match the Base Scene's environment.
      5. **Detail Preservation**: The new car must retain the identity (make, model, color, rims, details) of the Reference Vehicle.
      
      OUTPUT:
      High-quality photorealistic composite image.
    `;

    const response = await ai.models.generateContent({
      model: IMAGE_MODEL_NAME,
      contents: {
        parts: [
          { text: prompt },
          { inlineData: { data: cleanBase, mimeType: baseMimeType } },
          { inlineData: { data: cleanRef, mimeType: refMimeType } }
        ]
      },
      config: {
        temperature: 0.3
        // imageSize is only for Pro models
      }
    });

    let imageBase64Result: string | undefined;
    let textResponse: string | undefined;

    if (response.candidates && response.candidates[0].content && response.candidates[0].content.parts) {
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData && part.inlineData.data) {
           imageBase64Result = `data:image/png;base64,${part.inlineData.data}`;
        } else if (part.text) {
           textResponse = part.text;
        }
      }
    }

    if (imageBase64Result) {
      return imageBase64Result;
    }
    
    throw new Error(textResponse || "Failed to swap vehicle.");

  } catch (error) {
    console.error("Gemini API Error (Swap):", error);
    throw error;
  }
};

export const detectText = async (image: string): Promise<TextBlock[]> => {
    const ai = getAI();
    const model = TEXT_MODEL_NAME;

    const imagePart = {
        inlineData: {
            mimeType: 'image/png',
            data: image.split(',')[1],
        },
    };

    console.log('detectText: Sending request to Gemini...');
    const response = await ai.models.generateContent({
        model,
        contents: {
            parts: [
                { text: 'Analyze the image and detect ALL visible text elements including headlines, subheadlines, prices, slogans, and body copy. For each element, provide its exact text content and its bounding box as [x_min, y_min, x_max, y_max]. Return as a JSON array of objects with "text" and "box" keys.' },
                imagePart
            ]
        },
        config: {
            responseMimeType: 'application/json',
            // thinkingConfig is only for Gemini 3 series
            responseSchema: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        text: { type: Type.STRING },
                        box: { 
                            type: Type.ARRAY, 
                            items: { type: Type.NUMBER }
                        }
                    }
                }
            }
        }
    });

    console.log('detectText: Received response from Gemini');
    if (response.text) {
        let jsonText = response.text.trim();
        console.log('detectText: Raw response text:', jsonText);
        // Remove markdown code blocks if present
        jsonText = jsonText.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
        try {
            const parsed = JSON.parse(jsonText);
            console.log('detectText: Successfully parsed JSON');
            return parsed;
        } catch (parseError) {
            console.error('detectText: JSON parse error:', parseError);
            throw parseError;
        }
    }
    throw new Error("No text part found in response for text detection.");
};

export const removeDisclaimer = async (image: string): Promise<{ image: string; disclaimer: string }> => {
    const ai = getAI();
    const model = IMAGE_MODEL_NAME;

    const imagePart = {
        inlineData: {
            mimeType: 'image/png',
            data: image.split(',')[1],
        },
    };

    const response = await ai.models.generateContent({
        model: IMAGE_MODEL_NAME,
        contents: {
            parts: [
                { text: `
                Find the disclaimer text in this ad creative. Return the full disclaimer string prefixed with "DISCLAIMER_TEXT:". 
                Also, generate the image with the disclaimer seamlessly removed via inpainting. 
                
                CRITICAL QUALITY RULES:
                1. **Preserve Subject**: The vehicle (car), its geometry, lighting, and reflections must remain 100% identical.
                2. **Logos & Plates**: The car manufacturer logo (badge) and the license plate MUST be preserved PIXEL-PERFECT. Do not blur, warp, or change even a single character on the plate.
                3. **Seamless Inpainting**: The inpainted area where the disclaimer was should perfectly match the surrounding background texture.
                4. **No Hallucinations**: Do not add any new elements to the image.
                ` },
                imagePart
            ]
        },
        // imageSize is only for Pro models
    });
    
    let disclaimerText: string | undefined;
    let imageBase64: string | undefined;

    if (response.candidates && response.candidates[0].content && response.candidates[0].content.parts) {
        for (const part of response.candidates[0].content.parts) {
            if (part.text) {
                const match = part.text.match(/DISCLAIMER_TEXT:\s*(.*)/s);
                if (match) {
                    disclaimerText = match[1].trim();
                }
            } else if (part.inlineData) {
                imageBase64 = part.inlineData.data;
            }
        }
    }

    if (imageBase64) {
        const newImage = `data:image/png;base64,${imageBase64}`;
        return { image: newImage, disclaimer: disclaimerText || "" };
    } else {
        throw new Error("Invalid response from model: missing image data.");
    }
};

export const generateStoryAd = async (image: string, story: string): Promise<string> => {
    const ai = getAI();
    const model = IMAGE_MODEL_NAME;

    const imagePart = {
        inlineData: {
            mimeType: 'image/png',
            data: image.split(',')[1],
        },
    };

    const prompt = `
    Create a compelling story ad in a 9:16 vertical format.
    Use the provided image as the background and visual theme.
    Incorporate the following story into the ad, placing the text in a visually appealing way that complements the image:

    Story: "${story}"

    The final output should be a single, high-quality image that looks like a professional story ad.
    `;

    const response = await ai.models.generateContent({
        model: IMAGE_MODEL_NAME,
        contents: {
            parts: [{ text: prompt }, imagePart]
        },
        config: {
            imageConfig: {
                aspectRatio: '9:16'
                // imageSize is only for Pro models
            }
        }
    });

    const result = response;
    if (result.candidates && result.candidates[0].content.parts[0].inlineData) {
        const base64Data = result.candidates[0].content.parts[0].inlineData.data;
        return `data:image/png;base64,${base64Data}`;
    } else {
        throw new Error("Failed to generate story ad or no image data in response");
    }
};

export const replaceText = async (image: string, changes: { oldText: string; newText: string }[]): Promise<string> => {
    const ai = getAI();
    const model = IMAGE_MODEL_NAME;

    const imagePart = {
        inlineData: {
            mimeType: 'image/png',
            data: image.split(',')[1],
        },
    };

    const prompt = `
    Apply every text replacement below. You must perform ALL of them; do not skip or merge any. Each bullet is one required replacement.

    REPLACEMENTS (apply every one):
    ${changes.map((c, i) => {
      const oldStr = (c.oldText ?? '').replace(/\n/g, ' ').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const newStr = (c.newText ?? '').replace(/\n/g, ' ').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      return `${i + 1}. Replace this exact text: "${oldStr}" → with: "${newStr}"`;
    }).join('\n')}

    MANDATORY CLEANUP:
    1. **Remove Legal/Fine Print**: Detect and ERASE any small legal text, disclaimers, or footnotes at the bottom or edges of the image.

    CRITICAL QUALITY RULES:
    1. **Preserve Subject**: The vehicle (car), its geometry, lighting, and reflections must remain 100% identical.
    2. **Logos & Plates**: The car manufacturer logo (badge) and the license plate MUST be preserved PIXEL-PERFECT. Do not blur, warp, or change even a single character on the plate.
    3. **Seamless Text**: Match the original font, style, color, and positioning. Long lines must stay on one line or wrap as in the original. The replacement must look native to the photo.
    4. **No Hallucinations**: Do not add or change anything else in the image.
    `;

    const response = await ai.models.generateContent({
        model: IMAGE_MODEL_NAME,
        contents: {
            parts: [{ text: prompt }, imagePart]
        }
    });

    const content = response.candidates?.[0]?.content;
    if (content?.parts) {
        for (const part of content.parts) {
            if (part.inlineData?.data) {
                return `data:image/png;base64,${part.inlineData.data}`;
            }
        }
    }
    const fallbackMessage = content?.parts?.find((p: any) => p.text)?.text;
    throw new Error(fallbackMessage || "Failed to generate image or no image data in response");
};
