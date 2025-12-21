// api/apis.js
const fetch = require('node-fetch'); // Necesario para Node.js

// Función para rotar claves de API
const rotateKeys = (keys) => {
    let currentIndex = 0;
    return () => {
        const key = keys[currentIndex];
        currentIndex = (currentIndex + 1) % keys.length;
        return key;
    };
};

// --- CONFIGURACIÓN DE CLAVES Y MODELOS DE ROUTELLM ---
// Claves para modelos de texto (RouteLLM)
const ROUTELLM_TEXT_KEYS = [
    process.env.ROUTELLM_KEY_1,
    process.env.ROUTELLM_KEY_2,
    process.env.ROUTELLM_KEY_3,
    process.env.ROUTELLM_KEY_4
].filter(Boolean); // Filtra valores nulos/indefinidos

// Claves para modelos de imagen (RouteLLM)
const ROUTELLM_IMAGE_KEYS = [
    process.env.ROUTELLM_IMAGE_KEY_1,
    process.env.ROUTELLM_IMAGE_KEY_2,
    process.env.ROUTELLM_IMAGE_KEY_3,
    process.env.ROUTELLM_IMAGE_KEY_4,
    process.env.ROUTELLM_IMAGE_KEY_5
].filter(Boolean);

// Modelos por defecto (si no se especifican en las variables de entorno)
// ¡IMPORTANTE! Asegúrate de que estos modelos estén disponibles en tu plan de RouteLLM
// y que sean los más económicos si esa es tu prioridad.
// Si ROUTELLM_TEXT_MODEL no está definido, el código fallará, forzando la configuración.
const ROUTELLM_TEXT_MODEL = process.env.ROUTELLM_TEXT_MODEL;
const ROUTELLM_IMAGE_MODEL = process.env.ROUTELLM_IMAGE_MODEL; // Puede ser null si solo usas HF

// Validar que al menos una clave de texto y un modelo de texto estén configurados
if (ROUTELLM_TEXT_KEYS.length === 0) {
    console.error("ERROR: No se ha configurado ninguna ROUTELLM_KEY_X para modelos de texto.");
    // No lanzamos error aquí directamente para que el handler pueda devolver un 500 más amigable.
}
if (!ROUTELLM_TEXT_MODEL) {
    console.error("ERROR: No se ha configurado ROUTELLM_TEXT_MODEL. Por favor, especifica un modelo de texto.");
}

const getNextRouteLLMTextKey = rotateKeys(ROUTELLM_TEXT_KEYS);
const getNextRouteLLMImageKey = rotateKeys(ROUTELLM_IMAGE_KEYS);

// --- CONFIGURACIÓN DE HUGGING FACE (PARA IMÁGENES SI NO SE USA ROUTELLM) ---
const HF_API_URL = "https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0";
const HF_TOKEN = process.env.HF_TOKEN; // Token de Hugging Face para el servidor

// --- FUNCIÓN PRINCIPAL DEL HANDLER ---
module.exports = async (req, res) => {
    const { action } = req.query;
    const { prompt, token } = req.body; // 'token' es el token personal de HF del usuario

    res.setHeader('Content-Type', 'application/json');

    try {
        if (action === 'deck') {
            if (!ROUTELLM_TEXT_MODEL || ROUTELLM_TEXT_KEYS.length === 0) {
                throw new Error("Configuración de RouteLLM incompleta para modelos de texto. Revisa ROUTELLM_KEY_X y ROUTELLM_TEXT_MODEL.");
            }

            const ROUTELLM_KEY = getNextRouteLLMTextKey();
            const ROUTELLM_API_URL = "https://routellm.abacus.ai/v1/chat/completions";

            const response = await fetch(ROUTELLM_API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${ROUTELLM_KEY}`
                },
                body: JSON.stringify({
                    model: ROUTELLM_TEXT_MODEL,
                    messages: [{ role: "user", content: prompt }],
                    temperature: 0.7,
                    max_tokens: 1500,
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                console.error("Error de RouteLLM (Texto):", errorData);
                throw new Error(`Error de RouteLLM: ${errorData.detail || response.statusText}`);
            }

            const data = await response.json();
            const text = data.choices[0].message.content;
            return res.status(200).json({ text });

        } else if (action === 'image') {
            // Priorizar RouteLLM para imágenes si está configurado
            if (ROUTELLM_IMAGE_MODEL && ROUTELLM_IMAGE_KEYS.length > 0) {
                const ROUTELLM_KEY = getNextRouteLLMImageKey();
                const ROUTELLM_API_URL = "https://routellm.abacus.ai/v1/images/generations";

                const response = await fetch(ROUTELLM_API_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${ROUTELLM_KEY}`
                    },
                    body: JSON.stringify({
                        model: ROUTELLM_IMAGE_MODEL,
                        prompt: prompt,
                        n: 1,
                        size: "1024x576", // Ajustado para 16:9
                        response_format: "b64_json"
                    })
                });

                if (!response.ok) {
                    const errorData = await response.json();
                    console.error("Error de RouteLLM (Imagen):", errorData);
                    // Si RouteLLM falla, intentamos con Hugging Face como fallback
                    console.warn("RouteLLM Image Generation Fallback to Hugging Face due to error.");
                    return await handleHuggingFaceImage(prompt, token, res);
                }

                const data = await response.json();
                const image = `data:image/png;base64,${data.data[0].b64_json}`;
                return res.status(200).json({ image });

            } else {
                // Usar Hugging Face si RouteLLM para imágenes no está configurado
                return await handleHuggingFaceImage(prompt, token, res);
            }

        } else {
            return res.status(400).json({ error: 'Acción no válida.' });
        }
    } catch (error) {
        console.error("Error en el handler:", error);
        return res.status(500).json({ error: error.message || 'Error interno del servidor.' });
    }
};

// Función auxiliar para manejar la generación de imágenes con Hugging Face
async function handleHuggingFaceImage(prompt, userToken, res) {
    const finalToken = userToken || HF_TOKEN;
    if (!finalToken) {
        throw new Error("No se ha configurado un token de Hugging Face para la generación de imágenes.");
    }

    const hfResponse = await fetch(HF_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${finalToken}`
        },
        body: JSON.stringify({ inputs: prompt, parameters: { width: 1024, height: 576 } })
    });

    if (!hfResponse.ok) {
        const errorText = await hfResponse.text();
        console.error("Error de Hugging Face:", errorText);
        throw new Error(`Error de Hugging Face: ${errorText}`);
    }

    const imageBlob = await hfResponse.blob();
    const buffer = await imageBlob.arrayBuffer();
    const base64Image = Buffer.from(buffer).toString('base64');
    const image = `data:image/png;base64,${base64Image}`;
    return res.status(200).json({ image });
}
