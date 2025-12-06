// api/apis.js
// Este archivo Serverless (Node.js) maneja tanto Gemini (texto) como SDXL (imágenes).
// Implementa rotación de claves para aumentar la fiabilidad con hasta 4 claves Gemini y 5 claves HF.

import { Buffer } from 'buffer';

// --- FUNCIONES INTERNAS (GEMINI: Texto) ---
// La función ahora recibe un array de claves y las prueba en secuencia
const fetchGemini = async (prompt, keys) => {
    if (keys.length === 0) {
        throw new Error("No hay claves Gemini configuradas en el servidor.");
    }

    // Rotación de claves: iterar sobre cada clave configurada
    for (const key of keys) {
        let attempts = 0;
        const delays = [1000, 2500]; // Retrasos cortos para reintentos por clave

        while (attempts < 3) { // 3 intentos por clave (1 original + 2 reintentos)
            try {
                const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${key}`;

                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
                });

                const data = await response.json();

                if (response.ok) {
                    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
                    if (!text) throw new Error("Gemini returned empty content.");
                    return text; // ÉXITO
                } else if (response.status === 503 || response.status === 429) {
                    // Falla por saturación/rate limit, reintentar con la misma clave
                    attempts++;
                    if (attempts < 3) {
                        await new Promise(resolve => setTimeout(resolve, delays[attempts] || 500));
                        continue;
                    }
                    // Si falla después de reintentos, pasamos a la siguiente clave
                    throw new Error(`Key failed after retries: ${response.status}`);
                } else {
                    // Falla no relacionada con saturación, pasamos inmediatamente a la siguiente clave
                    throw new Error(`Permanent error: ${data.error?.message || response.status}`);
                }
            } catch (error) {
                // Capturamos el error y probamos la siguiente clave
                console.warn(`Key failed: ${error.message}. Trying next key.`);
                break; // Salir del bucle while e ir al siguiente key del bucle for
            }
        }
    }
    // Si llegamos aquí, todas las claves y reintentos fallaron
    throw new Error("Todas las claves Gemini están saturadas o son inválidas.");
};

// --- FUNCIONES INTERNAS (SDXL/HUGGING FACE: Imagen) ---
// La función ahora recibe un array de claves y las prueba en secuencia
const fetchSDXL = async (prompt, keys) => {
    if (keys.length === 0) {
        throw new Error("No hay claves Hugging Face configuradas en el servidor.");
    }

    for (const key of keys) {
        try {
            const response = await fetch(
                "https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0",
                {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${key}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ inputs: prompt + ", photorealistic, 8k, high quality" }),
                }
            );

            if (response.ok) {
                // ÉXITO
                const blob = await response.blob();
                const arrayBuffer = await response.arrayBuffer();
                const base64 = Buffer.from(arrayBuffer).toString('base64');
                const dataUrl = `data:${blob.type};base64,${base64}`;
                return dataUrl;
            } else {
                // Si falla (ej. 429 Rate Limit), intentamos inmediatamente con la siguiente clave
                const errorText = await response.text();
                console.warn(`HF Key failed: ${response.status} - ${errorText.substring(0, 100)}. Trying next key.`);
                continue;
            }
        } catch (error) {
            console.error(`Error with key: ${error.message}. Trying next key.`);
            continue;
        }
    }
    // Si llegamos aquí, todas las claves fallaron
    throw new Error("Todas las claves Hugging Face están saturadas o son inválidas.");
};

// --- FUNCIÓN UTILITARIA PARA CARGAR CLAVES ---
const loadKeys = (baseName, count) => {
    const keys = [];
    for (let i = 1; i <= count; i++) {
        const key = process.env[`${baseName}_${i}`];
        if (key) {
            keys.push(key);
        }
    }
    return keys;
};

// --- MANEJADOR PRINCIPAL ---
export default async function handler(req, res) {
    const { action } = req.query; 

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!req.body.prompt && action !== 'image') {
        return res.status(400).json({ error: 'Prompt is required.' });
    }

    try {
        switch (action) {
            case 'deck': {
                // LLAMADA A GEMINI con rotación de 4 claves
                const GEMINI_KEYS = loadKeys('GEMINI_KEY', 4); // Carga 4 claves
                if (GEMINI_KEYS.length === 0) return res.status(500).json({ error: 'Faltan claves GEMINI_KEY_N configuradas.' });
                
                const text = await fetchGemini(req.body.prompt, GEMINI_KEYS);
                return res.status(200).json({ text: text });
            }

            case 'image': {
                // LLAMADA A SDXL con rotación de 5 claves
                const SERVER_HF_KEYS = loadKeys('HF_TOKEN', 5); // Carga 5 claves
                const USER_TOKEN = req.body.token; // Token opcional del usuario (desde el localStorage del cliente)

                // Si el usuario proporciona un token, lo intentamos primero.
                if (USER_TOKEN) {
                    try {
                        const imageUrl = await fetchSDXL(req.body.prompt, [USER_TOKEN]); // Intentamos solo el token del usuario
                        return res.status(200).json({ image: imageUrl }); // ÉXITO con token de usuario
                    } catch (e) {
                        console.warn('Token de usuario falló. Recurriendo a claves del servidor.');
                        // Si falla, caemos en la rotación del servidor
                    }
                }
                
                // Rotación del servidor (si el token de usuario falló o no existe)
                if (SERVER_HF_KEYS.length === 0) return res.status(500).json({ error: 'Faltan claves HF_TOKEN_N configuradas.' });

                const imageUrl = await fetchSDXL(req.body.prompt, SERVER_HF_KEYS);
                return res.status(200).json({ image: imageUrl });
            }

            default:
                return res.status(400).json({ error: 'Invalid action specified.' });
        }
    } catch (error) {
        console.error("Consolidated API Error:", error.message);
        return res.status(500).json({ error: `Server API Error: ${error.message}` });
    }
}
