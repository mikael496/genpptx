# api/generate.py
import os
import json
import requests
from http.server import BaseHTTPRequestHandler, HTTPServer

# Constantes
ROUTELLM_BASE_URL = "https://routellm.abacus.ai/v1"
HUGGINGFACE_API_URL = "https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0"

def get_routellm_text_key():
    key = os.environ.get("ROUTELLM_KEY_1")
    if not key:
        raise ValueError("No RouteLLM text API key found. Please set ROUTELLM_KEY_1 in your environment variables.")
    return key

def get_huggingface_key():
    key = os.environ.get("HF_API_KEY")
    if not key:
        raise ValueError("No Hugging Face API key found. Please set HF_API_KEY in your environment variables.")
    return key

def handler(request, response):
    if request.method == "POST":
        try:
            body = json.loads(request.body)
            action = body.get("action")
            prompt = body.get("prompt")
            negative_prompt = body.get("negative_prompt")

            if not action:
                response.status = 400
                response.headers["Content-Type"] = "application/json"
                response.send_text(json.dumps({"error": "Missing action in request body."}))
                return

            if action == "deck":
                if not prompt:
                    response.status = 400
                    response.headers["Content-Type"] = "application/json"
                    response.send_text(json.dumps({"error": "Missing prompt for deck action."}))
                    return

                try:
                    api_key = get_routellm_text_key()
                    text_model = os.environ.get("ROUTELLM_TEXT_MODEL")

                    if not text_model:
                        response.status = 500
                        response.headers["Content-Type"] = "application/json"
                        response.send_text(json.dumps({"error": "ROUTELLM_TEXT_MODEL environment variable is not set."}))
                        return

                    payload = {
                        "model": text_model,
                        "messages": [
                            {"role": "system", "content": "You are a helpful assistant that generates presentation content."},
                            {"role": "user", "content": prompt},
                        ],
                        "max_tokens": 2000,
                    }
                    headers = {
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {api_key}",
                    }

                    routellm_response = requests.post(f"{ROUTELLM_BASE_URL}/chat/completions", json=payload, headers=headers)
                    routellm_response.raise_for_status() # Lanza una excepción para errores HTTP (4xx o 5xx)

                    data = routellm_response.json()
                    response.status = 200
                    response.headers["Content-Type"] = "application/json"
                    response.send_text(json.dumps(data))

                except ValueError as e:
                    response.status = 500
                    response.headers["Content-Type"] = "application/json"
                    response.send_text(json.dumps({"error": str(e)}))
                except requests.exceptions.RequestException as e:
                    print(f"RouteLLM API error: {e}")
                    error_message = str(e)
                    if routellm_response and routellm_response.status_code:
                        error_message = routellm_response.json().get("message", error_message)
                        response.status = routellm_response.status_code
                    else:
                        response.status = 500
                    response.headers["Content-Type"] = "application/json"
                    response.send_text(json.dumps({"error": error_message or "Error from RouteLLM API"}))
                except Exception as e:
                    print(f"Error in deck generation: {e}")
                    response.status = 500
                    response.headers["Content-Type"] = "application/json"
                    response.send_text(json.dumps({"error": str(e)}))

            elif action == "image":
                # Lógica para la generación de imágenes con Hugging Face en Python
                # Similar a la lógica de deck, pero llamando a HUGGINGFACE_API_URL
                response.status = 501 # Not Implemented yet
                response.headers["Content-Type"] = "application/json"
                response.send_text(json.dumps({"error": "Image generation not yet implemented in Python backend."}))

            else:
                response.status = 400
                response.headers["Content-Type"] = "application/json"
                response.send_text(json.dumps({"error": "Invalid action"}))

        except json.JSONDecodeError:
            response.status = 400
            response.headers["Content-Type"] = "application/json"
            response.send_text(json.dumps({"error": "Invalid JSON in request body."}))
        except Exception as e:
            print(f"Unhandled error: {e}")
            response.status = 500
            response.headers["Content-Type"] = "application/json"
            response.send_text(json.dumps({"error": "Internal Server Error"}))
    else:
        response.status = 405
        response.headers["Content-Type"] = "application/json"
        response.send_text(json.dumps({"error": "Method not allowed"}))

# Vercel usa un objeto de solicitud/respuesta diferente para Python.
# Este es un ejemplo simplificado de cómo Vercel podría invocar tu handler.
# En un entorno real de Vercel, no necesitarías el HTTPServer.
# Vercel inyecta un objeto 'request' y 'response' en tu función.
# Para fines de demostración, esto es conceptual.
