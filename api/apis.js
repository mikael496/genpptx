const ROUTELLM_BASE_URL = 'https://routellm.abacus.ai/v1';
const HUGGINGFACE_API_URL = 'https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0'; // URL de la API de Hugging Face para SDXL

// Función para obtener una clave de RouteLLM para texto
const getRouteLLMTextKey = () => {
  const keys = [
    process.env.ROUTELLM_KEY_1,
  ].filter(Boolean);

  if (keys.length === 0) {
    throw new Error('No RouteLLM text API keys found. Please set ROUTELLM_KEY_1 in your environment variables.');
  }
  return keys[0];
};

// Función para obtener una clave de Hugging Face (para imágenes)
const getHuggingFaceKey = () => {
  const hfKey = process.env.HF_API_KEY;
  if (!hfKey) {
    throw new Error('No Hugging Face API key found. Please set HF_API_KEY in your environment variables.');
  }
  return hfKey;
};

module.exports = async function handler(req, res) {
  // Asegurarse de que el body esté parseado
  let parsedBody = req.body;
  if (typeof req.body === 'string') {
    try {
      parsedBody = JSON.parse(req.body);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid JSON in request body.' });
    }
  }

  if (req.method === 'POST') {
    const { action, prompt, negative_prompt } = parsedBody;

    if (action === 'deck') {
      try {
        const apiKey = getRouteLLMTextKey();
        const textModel = process.env.ROUTELLM_TEXT_MODEL;

        if (!textModel) {
          return res.status(500).json({ error: 'ROUTELLM_TEXT_MODEL environment variable is not set.' });
        }

        const response = await fetch(`${ROUTELLM_BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: textModel,
            messages: [
              { role: 'system', content: 'You are a helpful assistant that generates presentation content.' },
              { role: 'user', content: prompt },
            ],
            max_tokens: 2000,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          console.error('RouteLLM API error:', errorData);
          return res.status(response.status).json({ error: errorData.message || 'Error from RouteLLM API' });
        }

        const data = await response.json();
        res.status(200).json(data);
      } catch (error) {
        console.error('Error in deck generation:', error);
        res.status(500).json({ error: error.message });
      }
    } else if (action === 'image') {
      try {
        const hfApiKey = getHuggingFaceKey();

        const response = await fetch(HUGGINGFACE_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${hfApiKey}`,
          },
          body: JSON.stringify({
            inputs: prompt,
            parameters: {
              negative_prompt: negative_prompt,
            },
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          console.error('Hugging Face API error:', errorData);
          return res.status(response.status).json({ error: errorData.error || 'Error from Hugging Face API' });
        }

        const imageBlob = await response.blob();
        const arrayBuffer = await imageBlob.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const base64Image = buffer.toString('base64');

        res.status(200).json({ image: base64Image });
      } catch (error) {
        console.error('Error generating image with Hugging Face:', error);
        res.status(500).json({ error: error.message });
      }
    } else {
      res.status(400).json({ error: 'Invalid action' });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
};
