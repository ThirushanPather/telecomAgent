import os
import google.generativeai as genai
from dotenv import load_dotenv

# Load environment variables from the .env file
load_dotenv()

# Configure the Google AI Studio API key
api_key = os.getenv("GEMINI_API_KEY")
if not api_key:
    print("Error: GEMINI_API_KEY not found in .env file.")
    exit(1)

print("API Key loaded successfully. Attempting to generate a test response...")

genai.configure(api_key=api_key)

try:
    # Use the recommended fast model for the test
    model = genai.GenerativeModel('gemini-2.5-flash')
    response = model.generate_content("Hello! This is a test. Could you confirm you are online and working?")
    
    print("\n" + "="*50)
    print("SUCCESS! The API key is valid and the model responded:")
    print("="*50)
    print(response.text)
    print("="*50 + "\n")
    
except Exception as e:
    print("\n" + "="*50)
    print("FAILED! There was an error using the API key:")
    print(e)
    print("="*50 + "\n")
