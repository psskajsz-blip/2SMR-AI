from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from ddgs import DDGS
import requests

app = FastAPI(title="2SMR AI")

OLLAMA_URL = "http://localhost:11434/api/chat"
MODEL = "2-smr-rapida"

app.mount("/web", StaticFiles(directory="web"), name="web")


class ChatRequest(BaseModel):
    message: str
    history: list[dict] = Field(default_factory=list)


@app.get("/")
def home():
    return FileResponse("web/index.html")


def buscar_internet(consulta):
    """
    Busca información en Internet y devuelve
    los resultados encontrados.
    """

    try:
        resultados = DDGS().text(
            consulta,
            max_results=5
        )

        fuentes = []

        for resultado in resultados:
            fuentes.append({
                "titulo": resultado.get("title", ""),
                "url": resultado.get("href", ""),
                "contenido": resultado.get("body", "")
            })

        return fuentes

    except Exception as error:
        print(f"Error en la búsqueda web: {error}")
        return []


@app.post("/chat")
def chat(data: ChatRequest):

    # Buscar información en Internet
    resultados = buscar_internet(data.message)

    # Preparar la información encontrada
    if resultados:
        informacion_web = "\n\n".join(
            [
                f"Título: {fuente['titulo']}\n"
                f"URL: {fuente['url']}\n"
                f"Información: {fuente['contenido']}"
                for fuente in resultados
            ]
        )
    else:
        informacion_web = (
            "No se han encontrado resultados web "
            "para esta consulta."
        )

    # Instrucciones para la IA
    system_prompt = (
        "Eres 2SMR AI, un profesor especializado en "
        "el Grado Medio de Sistemas Microinformáticos "
        "y Redes, especialmente en segundo curso. "
        "Responde siempre en español, con explicaciones "
        "sencillas, paso a paso y ejemplos prácticos. "
        "Utiliza la información de Internet cuando "
        "sea relevante para responder. "
        "No inventes datos ni afirmes que has verificado "
        "algo si no lo has hecho. "
        "Si las fuentes no son suficientes, indícalo. "
        "Distingue los datos encontrados en Internet "
        "de tus propias explicaciones. "
        "Incluye al final las fuentes consultadas "
        "con sus enlaces cuando haya resultados."
    )

    # Preparar mensajes para Ollama
    messages = [
        {
            "role": "system",
            "content": system_prompt
        }
    ]

    # Añadir historial de conversación
    messages.extend(data.history)

    # Añadir la pregunta y los resultados web
    messages.append({
        "role": "user",
        "content": (
            f"Pregunta del usuario:\n{data.message}\n\n"
            f"Información encontrada en Internet:\n"
            f"{informacion_web}"
        )
    })

    try:
        response = requests.post(
            OLLAMA_URL,
            json={
                "model": MODEL,
                "messages": messages,
                "stream": False
            },
            timeout=300
        )

        response.raise_for_status()
        result = response.json()

        return {
            "response": result["message"]["content"],
            "sources": resultados
        }

    except requests.RequestException as error:
        return {
            "response": (
                "No he podido conectar con Ollama. "
                "Comprueba que Ollama está funcionando. "
                f"Detalle: {error}"
            ),
            "sources": resultados
        }