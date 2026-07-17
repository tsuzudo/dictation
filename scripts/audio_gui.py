import tkinter as tk
from tkinter import filedialog, scrolledtext, messagebox
import whisper
import subprocess
import threading

# -------------------------------
# Load Whisper model once
# -------------------------------
model = whisper.load_model("base")   # Change to "small" or "medium" if needed

# -------------------------------
# Transcription + LLM function
# -------------------------------
def process_audio(file_path):
    try:
        # Display status
        output_box.insert(tk.END, "Transcribing audio...\n")
        output_box.see(tk.END)

        # Run Whisper
        result = model.transcribe(file_path)
        transcript = result["text"]
        print(transcript)

        output_box.insert(tk.END, "\n===== TRANSCRIPTION =====\n")
        output_box.insert(tk.END, transcript + "\n")
        output_box.see(tk.END)

        # Create prompt for LLM
        prompt = f"""
        Here is a transcription of speech audio:

        \"\"\"{transcript}\"\"\"

        Please summarize the main points clearly.
        """

        output_box.insert(tk.END, "\nQuerying LLM (Ollama)...\n")
        output_box.see(tk.END)

        proc = subprocess.run(
            ["ollama", "run", "llama3"],
            input=prompt,
            text=True,
            capture_output=True
        )

        response = proc.stdout

        output_box.insert(tk.END, "\n===== LLM RESPONSE =====\n")
        output_box.insert(tk.END, response + "\n")
        output_box.see(tk.END)

    except Exception as e:
        messagebox.showerror("Error", str(e))


# -------------------------------
# Handle file selection
# -------------------------------
def choose_file():
    file_path = filedialog.askopenfilename(
        title="Select audio file",
        filetypes=[("Audio files", "*.wav *.mp3 *.m4a *.flac")]
    )
    if file_path:
        output_box.insert(tk.END, f"\nSelected file: {file_path}\n")
        output_box.see(tk.END)

        # Run in separate thread so GUI does not freeze
        threading.Thread(target=process_audio, args=(file_path,)).start()


# -------------------------------
# Build GUI
# -------------------------------
app = tk.Tk()
app.title("Audio Recognition with Whisper + LLM")
app.geometry("800x600")

# Button
select_btn = tk.Button(app, text="Select Audio File", command=choose_file, font=("Arial", 14))

select_btn.pack(pady=10)

#print("label")

#label1 = tk.Label(app, text="test label", font=("Arial", 14))
#label1.pack()

# Output box

output_box = scrolledtext.ScrolledText(app, wrap=tk.WORD, font=("Arial", 14))

output_box.pack(expand=True, fill="both")

app.mainloop()
