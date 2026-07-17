import whisper
import subprocess
import json

# -----------------------------------
# 1. LOAD AND RUN WHISPER
# -----------------------------------

print("Loading Whisper model...")
model = whisper.load_model("base")   # you can use "small" / "medium" if your Mac is strong

print("Transcribing audio...")
result = model.transcribe("audio.wav")
#result = model.transcribe("audio.m4a")
transcript = result["text"]

print("\n===== TRANSCRIPT =====")
print(transcript)

# -----------------------------------
# 2. SEND TO OLLAMA LLM
# -----------------------------------

prompt = f"""
You are an AI assistant. 
Here is a transcription of spoken audio:

\"\"\"{transcript}\"\"\"

Please summarize the content and tell me what the speaker is talking about.
"""

print("\nQuerying Ollama...")

proc = subprocess.run(
    ["ollama", "run", "llama3"],
    input=prompt,
    text=True,
    capture_output=True
)

response = proc.stdout

# -----------------------------------
# 3. SHOW RESULT
# -----------------------------------

print("\n===== LLM RESPONSE =====")
print(response)
