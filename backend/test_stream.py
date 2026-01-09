#!/usr/bin/env python3
"""
Test script to verify streaming is working
"""
import sys
import json

def generate_test_stream():
    """Generate a test SSE stream"""
    # Content chunks
    chunks = ["Hello", " ", "world", "!", " ", "This", " ", "is", " ", "streaming", "."]
    
    for chunk in chunks:
        data = json.dumps({"type": "content", "content": chunk})
        print(f"data: {data}\n", flush=True)
    
    # Metadata
    metadata = json.dumps({"type": "metadata", "ttft_ms": 100, "trace_id": "test-trace-123"})
    print(f"data: {metadata}\n", flush=True)
    
    # Done
    print("data: [DONE]\n", flush=True)

if __name__ == "__main__":
    generate_test_stream()
