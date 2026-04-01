"""
DAO AI Arena - Flask Backend
Serves React frontend and proxies Databricks API calls
"""
import os
import json
import time
from pathlib import Path
from typing import Dict, List, Any
from dotenv import load_dotenv
from flask import Flask, send_from_directory, jsonify, request, Response
from flask_cors import CORS
import requests
from databricks.sdk import WorkspaceClient
from databricks.sdk.core import Config
from databricks.sdk.service.serving import EndpointCoreConfigInput, ServedEntityInput
import mlflow

# Load environment variables
env_paths = [
    Path(__file__).parent / '.env',
    Path(__file__).parent.parent / '.env',
]
for env_path in env_paths:
    if env_path.exists():
        load_dotenv(env_path)
        break

# Initialize Flask app
app = Flask(__name__, static_folder='static', static_url_path='')
CORS(app)

# Databricks configuration
DATABRICKS_HOST = os.environ.get('DATABRICKS_HOST', '')
DATABRICKS_TOKEN = os.environ.get('DATABRICKS_TOKEN', '')

# Check if running in Databricks Apps
IS_DATABRICKS_APP = 'X-Forwarded-Access-Token' in request.headers if request else False


def get_workspace_host() -> str:
    """Get the Databricks workspace host URL with https:// scheme"""
    # First check environment variable
    workspace_host = os.environ.get('DATABRICKS_HOST', '')
    
    if not workspace_host and 'DATABRICKS_WORKSPACE_ID' in os.environ:
        # Construct from workspace ID
        workspace_id = os.environ.get('DATABRICKS_WORKSPACE_ID')
        
        # Determine cloud provider
        if request and 'X-Forwarded-Host' in request.headers:
            forwarded_host = request.headers.get('X-Forwarded-Host', '')
            if 'azure' in forwarded_host:
                workspace_host = f'https://adb-{workspace_id}.11.azuredatabricks.net'
            elif 'gcp' in forwarded_host:
                workspace_host = f'https://{workspace_id}.gcp.databricks.com'
            else:
                # AWS
                workspace_host = f'https://dbc-{workspace_id}.cloud.databricks.com'
        else:
            # Default to AWS format if we can't determine
            workspace_host = f'https://dbc-{workspace_id}.cloud.databricks.com'
    
    if not workspace_host:
        raise ValueError("Cannot determine Databricks workspace host. Set DATABRICKS_HOST environment variable.")
    
    # Ensure the host has https:// scheme
    if not workspace_host.startswith('http://') and not workspace_host.startswith('https://'):
        workspace_host = f'https://{workspace_host}'
    
    return workspace_host


def get_databricks_client() -> WorkspaceClient:
    """
    Get a WorkspaceClient using the default constructor.
    This uses environment variables, SDK config, or OBO authentication automatically.
    The SDK handles all authentication scenarios including Databricks Apps.
    """
    try:
        return WorkspaceClient()
    except Exception as e:
        print(f"Failed to create WorkspaceClient: {e}")
        raise


def get_databricks_auth_headers() -> Dict[str, str]:
    """Get authentication headers for Databricks API calls"""
    headers = {
        'Content-Type': 'application/json',
    }
    
    # In Databricks Apps, use the forwarded access token (OBO authentication)
    if request and 'X-Forwarded-Access-Token' in request.headers:
        token = request.headers.get('X-Forwarded-Access-Token')
        headers['Authorization'] = f'Bearer {token}'
        print(f"Using OBO token from X-Forwarded-Access-Token (length: {len(token) if token else 0})")
    elif DATABRICKS_TOKEN:
        headers['Authorization'] = f'Bearer {DATABRICKS_TOKEN}'
        print("Using DATABRICKS_TOKEN from environment")
    else:
        print("⚠️ No authentication token available!")
    
    return headers


@app.route('/api/health')
def health():
    """Health check endpoint"""
    return jsonify({'status': 'healthy', 'app': 'dao-ai-arena'})


@app.route('/api/auth/info')
def auth_info():
    """Get authentication info"""
    is_databricks = 'X-Forwarded-Access-Token' in request.headers
    
    return jsonify({
        'environment': 'databricks_app' if is_databricks else 'local',
        'host': request.headers.get('X-Forwarded-Host', DATABRICKS_HOST),
        'user': request.headers.get('X-Forwarded-User', 'local-user'),
        'email': request.headers.get('X-Forwarded-Email', 'local@example.com'),
    })


@app.route('/api/endpoints/all')
def list_all_endpoints():
    """List all available endpoints (Model Serving + Databricks Apps)"""
    try:
        w = get_databricks_client()
        
        endpoints = []
        errors = []
        
        # Get current user email for sorting
        current_user_email = None
        if request and 'X-Forwarded-Email' in request.headers:
            current_user_email = request.headers.get('X-Forwarded-Email')
        elif request and 'X-Forwarded-User' in request.headers:
            current_user_email = request.headers.get('X-Forwarded-User')
        
        print(f"Current user email: {current_user_email}")
        
        # Fetch Model Serving endpoints
        try:
            serving_endpoints_list = list(w.serving_endpoints.list())
            print(f"Found {len(serving_endpoints_list)} Model Serving endpoints")
            for endpoint in serving_endpoints_list:
                # Get state information
                state_value = 'UNKNOWN'
                if endpoint.state:
                    if endpoint.state.ready:
                        state_value = endpoint.state.ready.value
                    elif endpoint.state.config_update:
                        state_value = endpoint.state.config_update.value
                
                creator = endpoint.creator if endpoint.creator else None
                
                endpoints.append({
                    'id': endpoint.name,
                    'name': endpoint.name,
                    'endpoint_type': 'model_serving',
                    'state': state_value,
                    'url': f'/serving-endpoints/{endpoint.name}/invocations',
                    'creator': creator,
                    'is_mine': creator == current_user_email if current_user_email and creator else False,
                    'config': {
                        'task': endpoint.task if endpoint.task else 'llm/v1/chat',
                    }
                })
        except Exception as e:
            error_msg = str(e)
            print(f"Error fetching Model Serving endpoints: {error_msg}")
            if "required scopes" in error_msg.lower():
                errors.append("Missing API scope for Model Serving endpoints. Configure 'serving.serving-endpoints' scope in app settings.")
            else:
                errors.append(f"Error fetching Model Serving endpoints: {error_msg}")
        
        # Fetch Databricks Apps
        try:
            apps_list = list(w.apps.list())
            print(f"Found {len(apps_list)} Databricks Apps")
            for app in apps_list:
                # Skip the current app
                if app.name == 'dao-ai-arena':
                    continue
                
                # Get app state from app_status or compute_status
                state_value = 'UNKNOWN'
                if hasattr(app, 'app_status') and app.app_status and app.app_status.state:
                    state_value = app.app_status.state.value
                elif hasattr(app, 'compute_status') and app.compute_status and app.compute_status.state:
                    state_value = app.compute_status.state.value
                    
                # Store the full app URL for invocation
                app_url = app.url if app.url else None
                
                creator = getattr(app, 'creator', None)
                
                endpoints.append({
                    'id': app.name,
                    'name': app.name,
                    'endpoint_type': 'databricks_app',
                    'state': state_value,
                    'url': app_url,
                    'description': getattr(app, 'description', None),
                    'creator': creator,
                    'is_mine': creator == current_user_email if current_user_email and creator else False,
                })
        except Exception as e:
            error_msg = str(e)
            print(f"Error fetching Databricks Apps: {error_msg}")
            if "required scopes" in error_msg.lower():
                errors.append("Missing API scope for Databricks Apps. Configure 'apps' scope in app settings.")
            else:
                errors.append(f"Error fetching Databricks Apps: {error_msg}")
        
        # Sort endpoints: user's own first, then alphabetically
        def sort_key(endpoint):
            is_mine = endpoint.get('is_mine', False)
            name = endpoint.get('name', '').lower()
            # Return tuple: (not is_mine, name) so False (user's own) comes before True (others)
            return (not is_mine, name)
        
        endpoints.sort(key=sort_key)
        
        return jsonify({
            'endpoints': endpoints,
            'errors': errors if errors else None,
            'scope_configuration_needed': len(errors) > 0
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/endpoints/model-serving')
def list_model_serving_endpoints():
    """List Model Serving endpoints only"""
    try:
        w = get_databricks_client()
        serving_endpoints = w.serving_endpoints.list()
        
        endpoints = []
        for endpoint in serving_endpoints:
            endpoints.append({
                'id': endpoint.name,
                'name': endpoint.name,
                'endpoint_type': 'model_serving',
                'state': endpoint.state.config_update if endpoint.state else 'UNKNOWN',
                'url': f'/serving-endpoints/{endpoint.name}/invocations',
            })
        
        return jsonify({'endpoints': endpoints})
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/endpoints/databricks-apps')
def list_databricks_apps():
    """List Databricks Apps only"""
    try:
        w = get_databricks_client()
        apps = w.apps.list()
        
        endpoints = []
        for app in apps:
            # Skip the current app
            if app.name == 'dao-ai-arena':
                continue
                
            endpoints.append({
                'id': app.name,
                'name': app.name,
                'endpoint_type': 'databricks_app',
                'state': str(app.status.state) if app.status else 'UNKNOWN',
                'url': app.url if app.url else f'/apps/{app.name}',
                'description': app.description if app.description else None,
            })
        
        return jsonify({'endpoints': endpoints})
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def get_experiment_id_for_endpoint(endpoint_id: str, endpoint_type: str, app_obj=None) -> str | None:
    """Get the MLflow experiment ID associated with an endpoint.
    
    For model_serving endpoints, looks up the experiment via the served model's
    training run in MLflow. For databricks_app endpoints, extracts the experiment
    ID from the app's resources (set during dao-ai deployment).
    
    Args:
        endpoint_id: The endpoint or app name.
        endpoint_type: Either 'model_serving' or 'databricks_app'.
        app_obj: Pre-fetched App object to avoid duplicate SDK calls.
    """
    try:
        if endpoint_type == 'model_serving':
            w = get_databricks_client()
            mlflow_client = mlflow.tracking.MlflowClient()
            
            # Get endpoint details
            endpoint = w.serving_endpoints.get(name=endpoint_id)
            if not endpoint or not endpoint.config or not endpoint.config.served_entities:
                print(f"No served entities found for endpoint {endpoint_id}")
                return None
            
            # Get the first served model
            served_entity = endpoint.config.served_entities[0]
            model_name = served_entity.entity_name
            model_version = served_entity.entity_version
            
            if not model_name or not model_version:
                print(f"No model name/version found for endpoint {endpoint_id}")
                return None
            
            print(f"Endpoint '{endpoint_id}' serves model '{model_name}' version {model_version}")
            
            # Get model version details to find run_id
            version_details = mlflow_client.get_model_version(name=model_name, version=model_version)
            run_id = version_details.run_id
            
            if not run_id:
                print(f"No run_id found for model {model_name} version {model_version}")
                return None
            
            # Get run info to find experiment_id
            run_info = mlflow_client.get_run(run_id).info
            experiment_id = run_info.experiment_id
            
            print(f"Found experiment ID: {experiment_id}")
            return experiment_id
        
        elif endpoint_type == 'databricks_app':
            app = app_obj
            if not app:
                w = get_databricks_client()
                app = w.apps.get(endpoint_id)

            if app and app.resources:
                for resource in app.resources:
                    if resource.experiment and resource.experiment.experiment_id:
                        experiment_id = resource.experiment.experiment_id
                        print(f"Found experiment ID from app resource '{resource.name}': {experiment_id}")
                        return experiment_id
                print(f"No experiment resource found in app '{endpoint_id}' resources")
            else:
                print(f"No resources found for app '{endpoint_id}'")
            return None
        
        return None
    
    except Exception as e:
        print(f"Error getting experiment ID for endpoint {endpoint_id}: {e}")
        import traceback
        traceback.print_exc()
        return None


@app.route('/api/chat/stream', methods=['POST'])
def stream_endpoint():
    """Stream responses from an endpoint using SSE"""
    data = request.get_json()
    endpoint_id = data.get('endpoint_id')
    endpoint_type = data.get('endpoint_type')
    messages = data.get('messages', [])
    custom_input = data.get('custom_input', {})
    
    if not endpoint_id or not endpoint_type:
        return jsonify({'error': 'Missing endpoint_id or endpoint_type'}), 400
    
    # IMPORTANT: Capture auth headers BEFORE the generator runs
    # The generator runs outside request context, so we must capture these values now
    auth_headers = get_databricks_auth_headers()
    workspace_host = get_workspace_host()
    
    # For Databricks Apps, fetch the app object once and reuse for both
    # experiment ID lookup and URL extraction
    app_url = None
    app_obj = None
    if endpoint_type == 'databricks_app':
        try:
            w = get_databricks_client()
            app_obj = w.apps.get(endpoint_id)
            if app_obj and app_obj.url:
                app_url = app_obj.url.rstrip('/') + '/invocations'
        except Exception as e:
            print(f"Error getting app URL: {e}")
    
    # Get experiment ID for this endpoint (for trace search)
    experiment_id = get_experiment_id_for_endpoint(endpoint_id, endpoint_type, app_obj=app_obj)
    
    def generate():
        """Generator function for SSE streaming"""
        try:
            start_time = time.time()
            ttft_ms = None
            trace_id = None
            custom_outputs = {}  # Capture all custom outputs from databricks_output
            
            # Use pre-captured auth headers (from request context)
            headers = auth_headers
            
            # Determine URL and payload format based on endpoint type
            if endpoint_type == 'model_serving':
                url = f"{workspace_host}/serving-endpoints/{endpoint_id}/invocations"
                
                # Check if this is a foundation model (uses OpenAI format)
                # Foundation models start with "databricks-" (e.g., databricks-gpt-5)
                is_foundation_model = endpoint_id.startswith('databricks-')
                
                if is_foundation_model:
                    # Foundation models use OpenAI chat format with messages
                    print(f"Using OpenAI format for foundation model: {endpoint_id}")
                    chat_messages = []
                    for msg in messages:
                        chat_messages.append({
                            'role': msg.get('role', 'user'),
                            'content': msg.get('content', '')
                        })
                    payload = {
                        'messages': chat_messages,
                        'stream': True
                    }
                else:
                    # Custom models (Responses Agent) use input format
                    print(f"Using Responses Agent format for custom model: {endpoint_id}")
                    input_items = []
                    for msg in messages:
                        role = msg.get('role', 'user')
                        content = msg.get('content', '')
                        
                        if role == 'user':
                            input_items.append({
                                'type': 'message',
                                'role': 'user',
                                'content': [{'type': 'input_text', 'text': content}]
                            })
                        elif role == 'assistant':
                            input_items.append({
                                'type': 'message',
                                'role': 'assistant',
                                'content': [{'type': 'output_text', 'text': content}]
                            })
                    
                    payload = {
                        'input': input_items,
                        'stream': True
                    }
                
            elif endpoint_type == 'databricks_app':
                if not app_url:
                    yield f'data: {json.dumps({"type": "error", "error": "Could not find app URL"})}\n\n'
                    return
                url = app_url
                
                # Databricks Apps use Responses Agent format
                input_items = []
                for msg in messages:
                    role = msg.get('role', 'user')
                    content = msg.get('content', '')
                    
                    if role == 'user':
                        input_items.append({
                            'type': 'message',
                            'role': 'user',
                            'content': [{'type': 'input_text', 'text': content}]
                        })
                    elif role == 'assistant':
                        input_items.append({
                            'type': 'message',
                            'role': 'assistant',
                            'content': [{'type': 'output_text', 'text': content}]
                        })
                
                payload = {
                    'input': input_items,
                    'stream': True  # Request streaming response
                }
            else:
                yield f'data: {json.dumps({"type": "error", "error": "Unknown endpoint type"})}\n\n'
                return
            
            # Add custom_inputs to payload (Responses Agent format)
            # The custom_inputs should be a top-level key, not merged at root
            if custom_input and isinstance(custom_input, dict):
                # If user provides {"custom_inputs": {...}}, use as-is
                # Otherwise wrap in custom_inputs key
                if 'custom_inputs' in custom_input:
                    payload['custom_inputs'] = custom_input['custom_inputs']
                else:
                    payload['custom_inputs'] = custom_input
                print(f"Applied custom_inputs: {json.dumps(payload.get('custom_inputs', {}))}")
            
            print(f"Streaming from: {url}")
            print(f"Payload: {json.dumps(payload, indent=2)}")
            print(f"Headers: {', '.join([k for k in headers.keys()])}")
            
            # Make streaming request
            with requests.post(url, json=payload, headers=headers, timeout=120, stream=True) as response:
                print(f"Response status: {response.status_code}")
                if response.status_code == 401:
                    print(f"⚠️ 401 Unauthorized - Token issue detected")
                    print(f"Auth headers used: {list(headers.keys())}")
                response.raise_for_status()
                
                streaming_chunks_received = False
                accumulated_text = ""
                raw_lines = []  # Collect all lines for fallback parsing
                
                print(f"Starting to iterate response lines...")
                line_count = 0
                
                # Process streaming response
                for line in response.iter_lines():
                    line_count += 1
                    if not line:
                        print(f"Line {line_count}: empty, skipping")
                        continue
                    
                    print(f"Line {line_count}: {len(line)} bytes")
                    raw_lines.append(line)  # Save for potential fallback
                    
                    # Record TTFT on first chunk
                    if not streaming_chunks_received:
                        ttft_ms = int((time.time() - start_time) * 1000)
                    
                    try:
                        # Handle SSE format from Databricks
                        line_str = line.decode('utf-8')
                        print(f"Received line: {line_str[:100]}...")
                        
                        # Skip SSE prefixes
                        if line_str.startswith('data: '):
                            line_str = line_str[6:]
                        
                        if not line_str.strip() or line_str.strip() == '[DONE]':
                            continue
                        
                        chunk_data = json.loads(line_str)
                        
                        # Extract content from different response formats
                        content_chunk = ""
                        chunk_type = chunk_data.get('type', '')
                        
                        # Databricks Responses Agent streaming format
                        # {"type": "response.output_text.delta", "delta": "text"}
                        if chunk_type == 'response.output_text.delta':
                            content_chunk = chunk_data.get('delta', '')
                        
                        # Databricks Responses Agent done signal
                        elif chunk_type == 'response.output_text.done':
                            # Final text, can include trace_id
                            if 'text' in chunk_data:
                                content_chunk = chunk_data.get('text', '')
                        
                        # Databricks Responses Agent output item done - contains custom_outputs!
                        elif chunk_type == 'response.output_item.done':
                            print(f"Received response.output_item.done event: {json.dumps(chunk_data)[:500]}...")
                            # Extract custom_outputs from this event
                            if 'custom_outputs' in chunk_data:
                                custom_outputs = chunk_data['custom_outputs']
                                print(f"✅ Extracted custom_outputs from response.output_item.done: {json.dumps(custom_outputs)[:200]}...")
                            # Also check for trace_id
                            if 'databricks_output' in chunk_data:
                                databricks_out = chunk_data['databricks_output']
                                trace_id = databricks_out.get('trace_id')
                                print(f"Extracted trace_id from response.output_item.done: {trace_id}")
                            # Check inside 'item' field if present
                            if 'item' in chunk_data and isinstance(chunk_data['item'], dict):
                                item = chunk_data['item']
                                if 'custom_outputs' in item:
                                    custom_outputs = item['custom_outputs']
                                    print(f"✅ Extracted custom_outputs from response.output_item.done.item: {json.dumps(custom_outputs)[:200]}...")
                                if 'databricks_output' in item:
                                    trace_id = item['databricks_output'].get('trace_id')
                                    print(f"Extracted trace_id from response.output_item.done.item: {trace_id}")
                        
                        # Databricks Responses Agent metadata
                        elif chunk_type == 'response.done':
                            print(f"Received response.done event: {json.dumps(chunk_data)}")
                            # May contain trace_id in databricks_output
                            if 'databricks_output' in chunk_data:
                                databricks_out = chunk_data['databricks_output']
                                trace_id = databricks_out.get('trace_id')
                                print(f"Extracted trace_id from databricks_output: {trace_id}")
                            # custom_outputs is a separate field at root level
                            if 'custom_outputs' in chunk_data:
                                custom_outputs = chunk_data['custom_outputs']
                                print(f"Extracted custom_outputs from response.done: {json.dumps(custom_outputs)}")
                            # Also check response field which may contain the full response
                            if 'response' in chunk_data:
                                response_obj = chunk_data['response']
                                print(f"response.done has 'response' field with keys: {list(response_obj.keys()) if isinstance(response_obj, dict) else type(response_obj)}")
                                if isinstance(response_obj, dict):
                                    if 'custom_outputs' in response_obj:
                                        custom_outputs = response_obj['custom_outputs']
                                        print(f"Extracted custom_outputs from response.done.response: {json.dumps(custom_outputs)}")
                                    if 'databricks_output' in response_obj and not trace_id:
                                        trace_id = response_obj['databricks_output'].get('trace_id')
                                        print(f"Extracted trace_id from response.done.response.databricks_output: {trace_id}")
                        
                        # OpenAI-style streaming format (for Model Serving)
                        elif 'choices' in chunk_data and len(chunk_data['choices']) > 0:
                            delta = chunk_data['choices'][0].get('delta', {})
                            content_chunk = delta.get('content', '')
                            
                            # Try to get trace_id from metadata
                            if 'databricks_output' in chunk_data:
                                trace_id = chunk_data['databricks_output'].get('trace_id')
                        
                        # Simple content format
                        elif 'content' in chunk_data:
                            content_chunk = chunk_data['content']
                            if 'trace_id' in chunk_data:
                                trace_id = chunk_data['trace_id']
                        
                        # Direct delta format
                        elif 'delta' in chunk_data:
                            content_chunk = chunk_data.get('delta', '')
                        
                        # Send content chunk to client
                        if content_chunk:
                            streaming_chunks_received = True
                            accumulated_text += content_chunk
                            print(f"Sending chunk: {content_chunk[:50]}...")
                            yield f'data: {json.dumps({"type": "content", "content": content_chunk})}\n\n'
                    
                    except json.JSONDecodeError:
                        # Not valid JSON - might be part of a non-streaming response
                        print(f"Line not valid JSON, will try fallback")
                        continue
                    except Exception as e:
                        print(f"Error processing chunk: {e}")
                        continue
                
                print(f"Finished iterating: {line_count} total lines, {len(raw_lines)} non-empty lines, streaming_chunks_received={streaming_chunks_received}")
                
                # If no lines at all, something is wrong
                if not raw_lines and not streaming_chunks_received:
                    print("⚠️ No response content received at all!")
                    yield f'data: {json.dumps({"type": "error", "error": "No response content received from endpoint"})}\n\n'
                    return
                
                # If no streaming chunks were successfully parsed, try to parse all lines as complete JSON
                if not streaming_chunks_received and raw_lines:
                    print("⚠️ No streaming content extracted, parsing as complete response")
                    try:
                        # Combine all raw lines into a single response body
                        response_body = b'\n'.join(raw_lines).decode('utf-8')
                        print(f"Raw response body: {response_body[:500]}...")
                        result = json.loads(response_body)
                        
                        # Log the full response structure
                        print(f"Response keys: {list(result.keys())}")
                        
                        # Extract text from Responses Agent format
                        response_text = ""
                        if 'output' in result:
                            output_items = result.get('output', [])
                            for item in output_items:
                                if item.get('type') == 'message' and item.get('role') == 'assistant':
                                    content_items = item.get('content', [])
                                    for content in content_items:
                                        if content.get('type') == 'output_text':
                                            response_text += content.get('text', '')
                            
                            # Extract databricks_output for trace_id
                            databricks_output = result.get('databricks_output', {})
                            trace_id = databricks_output.get('trace_id')
                            print(f"Extracted trace_id: {trace_id}")
                            
                            # custom_outputs is at root level, separate from databricks_output
                            if 'custom_outputs' in result:
                                custom_outputs = result['custom_outputs']
                                print(f"Extracted custom_outputs from root: {list(custom_outputs.keys()) if isinstance(custom_outputs, dict) else type(custom_outputs)}")
                            else:
                                # Fall back to using databricks_output as custom_outputs
                                custom_outputs = databricks_output
                                print(f"Using databricks_output as custom_outputs: {list(custom_outputs.keys()) if isinstance(custom_outputs, dict) else 'empty'}")
                                
                        elif 'choices' in result and len(result['choices']) > 0:
                            response_text = result['choices'][0].get('message', {}).get('content', '')
                            if 'databricks_output' in result:
                                databricks_output = result['databricks_output']
                                trace_id = databricks_output.get('trace_id')
                                custom_outputs = databricks_output
                        else:
                            # Unknown format, just return the whole thing
                            response_text = result.get('response', json.dumps(result))
                        
                        ttft_ms = int((time.time() - start_time) * 1000)
                        
                        print(f"Non-streaming response, sending as single chunk: {len(response_text)} chars")
                        yield f'data: {json.dumps({"type": "content", "content": response_text})}\n\n'
                    
                    except Exception as e:
                        print(f"Error parsing non-streaming response: {e}")
                        import traceback
                        traceback.print_exc()
                        yield f'data: {json.dumps({"type": "error", "error": f"Failed to parse response: {str(e)}"})}\n\n'
                        return
                
                # Send metadata including custom outputs and experiment_id
                metadata = {}
                if ttft_ms is not None:
                    metadata['ttft_ms'] = ttft_ms
                if trace_id:
                    metadata['trace_id'] = trace_id
                if experiment_id:
                    metadata['experiment_id'] = experiment_id
                if custom_outputs:
                    metadata['custom_outputs'] = custom_outputs
                
                if metadata:
                    print(f"Sending metadata: trace_id={trace_id}, experiment_id={experiment_id}, custom_outputs keys={list(custom_outputs.keys()) if custom_outputs else []}")
                    yield f'data: {json.dumps({"type": "metadata", **metadata})}\n\n'
                
                # Send done signal
                yield f'data: [DONE]\n\n'
        
        except requests.exceptions.HTTPError as e:
            error_msg = str(e)
            print(f"HTTP Error in streaming: {error_msg}")
            
            if '401' in error_msg or 'Unauthorized' in error_msg:
                error_detail = "Authentication failed. The app may need API scope configuration or token permissions."
                print(f"⚠️ Authentication issue: {error_detail}")
                yield f'data: {json.dumps({"type": "error", "error": error_detail})}\n\n'
            elif '403' in error_msg or 'Forbidden' in error_msg:
                error_detail = f"Access denied to '{endpoint_id}'. You need CAN_QUERY permission on this endpoint, or try an endpoint you own."
                print(f"⚠️ Permission issue: {error_detail}")
                print(f"   The user's token doesn't have permission to query this endpoint.")
                print(f"   Fix: Go to Serving > {endpoint_id} > Permissions > Add user with CAN_QUERY")
                yield f'data: {json.dumps({"type": "error", "error": error_detail})}\n\n'
            else:
                yield f'data: {json.dumps({"type": "error", "error": error_msg})}\n\n'
                
        except Exception as e:
            print(f"Error in streaming: {e}")
            import traceback
            traceback.print_exc()
            yield f'data: {json.dumps({"type": "error", "error": str(e)})}\n\n'
    
    return Response(
        generate(), 
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',  # Disable nginx buffering
        }
    )


@app.route('/api/chat/invoke', methods=['POST'])
def invoke_endpoint():
    """Invoke an endpoint with a chat message using Databricks Responses Agent API format (non-streaming fallback)"""
    try:
        data = request.get_json()
        endpoint_id = data.get('endpoint_id')
        endpoint_type = data.get('endpoint_type')
        messages = data.get('messages', [])
        
        if not endpoint_id or not endpoint_type:
            return jsonify({'error': 'Missing endpoint_id or endpoint_type'}), 400
        
        print(f"Invoking endpoint: {endpoint_id} (type: {endpoint_type})")
        print(f"Messages: {messages}")
        
        start_time = time.time()
        w = get_databricks_client()
        
        if endpoint_type == 'model_serving':
            try:
                # Use SDK to invoke Model Serving endpoint
                # Try Responses Agent API format first
                input_items = []
                for msg in messages:
                    role = msg.get('role', 'user')
                    content = msg.get('content', '')
                    
                    if role == 'user':
                        input_items.append({
                            'type': 'message',
                            'role': 'user',
                            'content': [{'type': 'input_text', 'text': content}]
                        })
                    elif role == 'assistant':
                        input_items.append({
                            'type': 'message',
                            'role': 'assistant',
                            'content': [{'type': 'output_text', 'text': content}]
                        })
                
                # Build the request payload
                payload = {
                    'input': input_items
                }
                
                print(f"Sending payload: {json.dumps(payload, indent=2)}")
                
                # Use requests to call the endpoint directly
                headers = get_databricks_auth_headers()
                
                # Get workspace host (always use get_workspace_host to ensure https://)
                host = get_workspace_host()
                url = f"{host}/serving-endpoints/{endpoint_id}/invocations"
                
                # Track time to first byte (approximates time to first token)
                ttft_ms = None
                response_start = None
                
                # Use streaming to capture TTFT
                with requests.post(url, json=payload, headers=headers, timeout=60, stream=True) as response:
                    response.raise_for_status()
                    
                    # Record time to first byte
                    response_start = time.time()
                    
                    # Read first chunk to get TTFT
                    first_chunk = next(response.iter_content(chunk_size=1), None)
                    if first_chunk and response_start:
                        ttft_ms = int((time.time() - start_time) * 1000)
                    
                    # Read the rest of the response
                    content = first_chunk if first_chunk else b''
                    content += response.content
                    
                result = json.loads(content.decode('utf-8'))
                print(f"Got response: {json.dumps(result, indent=2)[:500]}...")
                
                # Extract response text from Responses Agent format
                response_text = ""
                trace_id = None
                
                # Check for Responses Agent format
                if 'output' in result:
                    output_items = result.get('output', [])
                    for item in output_items:
                        if item.get('type') == 'message' and item.get('role') == 'assistant':
                            content_items = item.get('content', [])
                            for content in content_items:
                                if content.get('type') == 'output_text':
                                    response_text += content.get('text', '')
                    
                    # Get trace ID from databricks_output
                    databricks_output = result.get('databricks_output', {})
                    trace_id = databricks_output.get('trace_id')
                
                # Fallback to standard chat format
                elif 'choices' in result and len(result['choices']) > 0:
                    response_text = result['choices'][0]['message']['content']
                    # Try to get trace from response headers or metadata
                    if 'databricks_output' in result:
                        trace_id = result['databricks_output'].get('trace_id')
                
                # Last fallback
                elif 'predictions' in result and len(result['predictions']) > 0:
                    response_text = result['predictions'][0]
                else:
                    response_text = json.dumps(result)
                
                # Calculate total latency
                latency_ms = int((time.time() - start_time) * 1000)
                
                # If TTFT wasn't captured, assume it's same as total (non-streaming)
                if ttft_ms is None:
                    ttft_ms = latency_ms
                
                response_data = {
                    'response': response_text,
                    'latency_ms': latency_ms,
                    'ttft_ms': ttft_ms,
                    'endpoint_type': 'model_serving',
                    'endpoint_id': endpoint_id,
                }
                
                if trace_id:
                    response_data['trace_id'] = trace_id
                    print(f"Got trace_id: {trace_id}")
                
                print(f"Latency: {latency_ms}ms, TTFT: {ttft_ms}ms")
                
                return jsonify(response_data)
                
            except Exception as e:
                print(f"Error invoking Model Serving endpoint: {e}")
                import traceback
                traceback.print_exc()
                return jsonify({'error': str(e)}), 500
        
        elif endpoint_type == 'databricks_app':
            # Invoke Databricks App endpoint
            try:
                headers = get_databricks_auth_headers()
                
                # Get the app URL - Databricks Apps have their own subdomain
                # Format: https://{app-name}-{workspace-id}.{region}.databricksapps.com
                # We need to fetch the app details to get the correct URL
                w = get_databricks_client()
                app = w.apps.get(endpoint_id)
                
                if not app or not app.url:
                    return jsonify({'error': f'Could not find URL for Databricks App: {endpoint_id}'}), 404
                
                # Use the app's URL and append /invocations
                app_base_url = app.url.rstrip('/')
                url = f"{app_base_url}/invocations"
                
                # Build payload in Responses Agent format
                input_items = []
                for msg in messages:
                    role = msg.get('role', 'user')
                    content = msg.get('content', '')
                    
                    if role == 'user':
                        input_items.append({
                            'type': 'message',
                            'role': 'user',
                            'content': [{'type': 'input_text', 'text': content}]
                        })
                    elif role == 'assistant':
                        input_items.append({
                            'type': 'message',
                            'role': 'assistant',
                            'content': [{'type': 'output_text', 'text': content}]
                        })
                
                payload = {
                    'input': input_items
                }
                
                # Track TTFT
                ttft_ms = None
                
                with requests.post(url, json=payload, headers=headers, timeout=60, stream=True) as response:
                    response.raise_for_status()
                    
                    # Read first chunk to get TTFT
                    first_chunk = next(response.iter_content(chunk_size=1), None)
                    if first_chunk:
                        ttft_ms = int((time.time() - start_time) * 1000)
                    
                    # Read the rest
                    content = first_chunk if first_chunk else b''
                    content += response.content
                    
                result = json.loads(content.decode('utf-8'))
                
                # Parse response - try Responses Agent format first
                response_text = ""
                trace_id = None
                
                if 'output' in result:
                    # Responses Agent format
                    output_items = result.get('output', [])
                    for item in output_items:
                        if item.get('type') == 'message' and item.get('role') == 'assistant':
                            content_items = item.get('content', [])
                            for content in content_items:
                                if content.get('type') == 'output_text':
                                    response_text += content.get('text', '')
                    
                    # Get trace ID
                    databricks_output = result.get('databricks_output', {})
                    trace_id = databricks_output.get('trace_id')
                else:
                    # Fallback to simple response format
                    response_text = result.get('response', json.dumps(result))
                    trace_id = result.get('trace_id')
                
                latency_ms = int((time.time() - start_time) * 1000)
                
                # If TTFT wasn't captured, use total latency
                if ttft_ms is None:
                    ttft_ms = latency_ms
                
                response_data = {
                    'response': response_text,
                    'latency_ms': latency_ms,
                    'ttft_ms': ttft_ms,
                    'endpoint_type': 'databricks_app',
                    'endpoint_id': endpoint_id,
                }
                
                if trace_id:
                    response_data['trace_id'] = trace_id
                
                print(f"Latency: {latency_ms}ms, TTFT: {ttft_ms}ms")
                
                return jsonify(response_data)
                
            except Exception as e:
                print(f"Error invoking Databricks App: {e}")
                return jsonify({'error': f"Error invoking Databricks App: {str(e)}"}), 500
        
        else:
            return jsonify({'error': f'Unknown endpoint type: {endpoint_type}'}), 400
    
    except Exception as e:
        print(f"Error in invoke_endpoint: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/traces/search', methods=['POST'])
def search_traces():
    """Search for traces by session/conversation ID"""
    try:
        data = request.get_json()
        session_id = data.get('session_id')
        thread_id = data.get('thread_id')
        conversation_id = data.get('conversation_id')
        experiment_id = data.get('experiment_id')  # Optional: specific experiment
        
        # Set up MLflow authentication using OBO token
        # Only set MLFLOW_TRACKING_TOKEN - don't set DATABRICKS_TOKEN to avoid auth conflicts
        obo_token = request.headers.get('X-Forwarded-Access-Token')
        if obo_token:
            os.environ['MLFLOW_TRACKING_TOKEN'] = obo_token
        
        workspace_host = get_workspace_host()
        mlflow.set_tracking_uri("databricks")
        
        print(f"Trace search - experiment_id: {experiment_id}, conversation_id: {conversation_id}, thread_id: {thread_id}")
        
        # Build filter string based on available identifiers
        filter_parts = []
        if conversation_id:
            filter_parts.append(f"tags.`mlflow.trace.session` = '{conversation_id}'")
        if thread_id and not conversation_id:
            filter_parts.append(f"tags.`mlflow.trace.session` = '{thread_id}'")
        if session_id and not conversation_id and not thread_id:
            filter_parts.append(f"tags.`mlflow.trace.session` = '{session_id}'")
        
        if not filter_parts:
            return jsonify({'error': 'No session/thread/conversation ID provided'}), 400
        
        filter_string = " OR ".join(filter_parts)
        print(f"Searching traces with filter: {filter_string}")
        
        # Get experiment IDs - we need at least one to search
        if experiment_id:
            experiment_ids = [experiment_id]
            print(f"Using provided experiment_id: {experiment_id}")
        else:
            # Without an experiment_id, we can't search traces
            # The experiment_id should come from the endpoint's model registry
            print("No experiment_id provided - cannot search traces without it")
            return jsonify({
                'error': 'No experiment ID available. The endpoint may not have MLflow tracing enabled, or the model is not registered in Unity Catalog.'
            }), 400
        
        # Search for traces across experiments
        traces = mlflow.search_traces(
            experiment_ids=experiment_ids,
            filter_string=filter_string,
            max_results=10,
            order_by=["timestamp DESC"]
        )
        
        if not traces or len(traces) == 0:
            print(f"No traces found for filter: {filter_string}")
            return jsonify({'error': 'No traces found for this session'}), 404
        
        # Return the most recent trace
        most_recent = traces[0]
        trace_id = most_recent.info.request_id
        print(f"Found trace: {trace_id}")
        
        return jsonify({
            'trace_id': trace_id,
            'trace_count': len(traces)
        })
    
    except Exception as e:
        print(f"Error searching traces: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/traces/<trace_id>')
def get_trace_endpoint(trace_id: str):
    """Fetch MLFlow trace by ID"""
    try:
        print(f"Fetching trace: {trace_id}")
        
        # Set up MLflow authentication using OBO token
        obo_token = request.headers.get('X-Forwarded-Access-Token')
        if obo_token:
            os.environ['MLFLOW_TRACKING_TOKEN'] = obo_token
            print(f"Set MLFLOW_TRACKING_TOKEN from OBO token (length: {len(obo_token)})")
        
        # Set MLFlow tracking URI to Databricks
        mlflow.set_tracking_uri("databricks")
        print(f"MLflow tracking URI set to databricks")
        
        # Get the trace
        from mlflow.tracing import get_trace
        trace = get_trace(trace_id)
        
        if not trace:
            return jsonify({'error': 'Trace not found'}), 404
        
        # Convert trace to dict
        trace_data = {
            'trace_id': trace.info.request_id,
            'experiment_id': trace.info.experiment_id,
            'timestamp_ms': trace.info.timestamp_ms,
            'execution_time_ms': trace.info.execution_time_ms,
            'status': trace.info.status,
            'spans': []
        }
        
        # Add spans with hierarchy info
        for span in trace.data.spans:
            span_data = {
                'name': span.name,
                'span_type': span.span_type,
                'start_time_ns': span.start_time_ns,
                'end_time_ns': span.end_time_ns,
                'status': span.status.status_code if span.status else 'UNSET',
                'inputs': span.inputs,
                'outputs': span.outputs,
                'attributes': span.attributes,
                'span_id': getattr(span, 'span_id', None) or span.name,
                'parent_id': getattr(span, 'parent_id', None),
            }
            trace_data['spans'].append(span_data)
        
        # Add MLflow UI URL for Databricks
        workspace_host = get_workspace_host()
        trace_data['mlflow_url'] = f"{workspace_host}/ml/experiments/{trace.info.experiment_id}/traces/{trace_id}"
        
        return jsonify({'trace': trace_data})
    
    except Exception as e:
        print(f"Error fetching trace: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


# Serve React frontend
@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve_frontend(path):
    """Serve React frontend"""
    static_folder = app.static_folder
    
    if path and os.path.exists(os.path.join(static_folder, path)):
        return send_from_directory(static_folder, path)
    else:
        return send_from_directory(static_folder, 'index.html')


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    debug = os.environ.get('DEBUG', 'False').lower() == 'true'
    
    # Get environment info for debugging
    workspace_id = os.environ.get('DATABRICKS_WORKSPACE_ID', 'not set')
    databricks_host = os.environ.get('DATABRICKS_HOST', 'not set')
    
    print(f"""
╔═════════════════════════════════════════════════╗
║        DAO AI Arena - Backend Server       ║
╚═════════════════════════════════════════════════╝

  Running on: http://0.0.0.0:{port}
  Environment: {'Databricks App' if IS_DATABRICKS_APP else 'Local Development'}
  Debug: {debug}
  Workspace ID: {workspace_id}
  Databricks Host: {databricks_host}

""")
    
    app.run(host='0.0.0.0', port=port, debug=debug)
