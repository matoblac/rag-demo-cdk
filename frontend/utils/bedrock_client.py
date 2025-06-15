"""
AWS Bedrock Client
Handles interactions with AWS Bedrock Knowledge Base and foundation models
"""

import boto3
import json
import logging
import time
from typing import Dict, Any, List, Optional, Tuple
from botocore.exceptions import ClientError
from datetime import datetime

logger = logging.getLogger(__name__)

class BedrockClient:
    """AWS Bedrock client for Knowledge Base and model interactions"""
    
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.region = config.get('region', 'us-east-1')
        
        # Initialize Bedrock clients
        self.bedrock_agent_runtime = boto3.client('bedrock-agent-runtime', region_name=self.region)
        self.bedrock_runtime = boto3.client('bedrock-runtime', region_name=self.region)
        
        # Cache for model information
        self._model_cache = {}
        
    def query_knowledge_base(
        self, 
        query: str, 
        max_results: int = 5,
        include_metadata: bool = True,
        search_type: str = "HYBRID"
    ) -> Dict[str, Any]:
        """
        Query the Bedrock Knowledge Base
        
        Args:
            query: The question/query to search for
            max_results: Maximum number of results to return
            include_metadata: Whether to include metadata in results
            search_type: Type of search (HYBRID, SEMANTIC, or KEYWORD)
        
        Returns:
            Dictionary containing query results and metadata
        """
        start_time = time.time()
        
        try:
            knowledge_base_id = self.config['knowledgeBaseId']
            
            response = self.bedrock_agent_runtime.retrieve(
                knowledgeBaseId=knowledge_base_id,
                retrievalQuery={'text': query},
                retrievalConfiguration={
                    'vectorSearchConfiguration': {
                        'numberOfResults': max_results,
                        'overrideSearchType': search_type
                    }
                }
            )
            
            # Process results
            results = []
            for item in response.get('retrievalResults', []):
                result = {
                    'content': item.get('content', {}).get('text', ''),
                    'score': item.get('score', 0.0),
                    'location': self._extract_location_info(item.get('location', {})),
                }
                
                if include_metadata:
                    result['metadata'] = item.get('metadata', {})
                
                results.append(result)
            
            query_time = time.time() - start_time
            
            return {
                'query': query,
                'results': results,
                'total_results': len(results),
                'query_time': query_time,
                'timestamp': datetime.utcnow().isoformat(),
                'search_type': search_type
            }
            
        except ClientError as e:
            logger.error(f"Error querying Knowledge Base: {e}")
            raise Exception(f"Knowledge Base query failed: {e}")
        except Exception as e:
            logger.error(f"Unexpected error in Knowledge Base query: {e}")
            raise
    
    def generate_response(
        self, 
        query: str, 
        context: List[str], 
        model_id: str = "anthropic.claude-3-sonnet-20240229-v1:0",
        temperature: float = 0.7,
        max_tokens: int = 4096
    ) -> Dict[str, Any]:
        """
        Generate response using retrieved context and a foundation model
        
        Args:
            query: The original user query
            context: List of context snippets from Knowledge Base
            model_id: Foundation model to use
            temperature: Model temperature (0.0-1.0)
            max_tokens: Maximum tokens to generate
        
        Returns:
            Dictionary containing generated response and metadata
        """
        start_time = time.time()
        
        try:
            # Create prompt with context
            context_text = "\n\n".join(context[:3]) if context else ""
            
            if context_text:
                prompt = f"""Based on the following context, please answer the question. If the context doesn't contain enough information to answer the question, please say so and provide what information you can.

Context:
{context_text}

Question: {query}

Answer:"""
            else:
                prompt = f"""I don't have specific context to answer this question, but I'll provide what general information I can.

Question: {query}

Answer:"""
            
            # Prepare request based on model type
            if "anthropic.claude" in model_id:
                request_body = {
                    "anthropic_version": "bedrock-2023-05-31",
                    "max_tokens": max_tokens,
                    "temperature": temperature,
                    "messages": [
                        {
                            "role": "user",
                            "content": prompt
                        }
                    ]
                }
            elif "amazon.titan" in model_id:
                request_body = {
                    "inputText": prompt,
                    "textGenerationConfig": {
                        "maxTokenCount": max_tokens,
                        "temperature": temperature,
                        "topP": 0.9
                    }
                }
            elif "ai21.j2" in model_id:
                request_body = {
                    "prompt": prompt,
                    "maxTokens": max_tokens,
                    "temperature": temperature
                }
            else:
                # Default to Claude format
                request_body = {
                    "anthropic_version": "bedrock-2023-05-31",
                    "max_tokens": max_tokens,
                    "temperature": temperature,
                    "messages": [
                        {
                            "role": "user",
                            "content": prompt
                        }
                    ]
                }
            
            # Invoke model
            response = self.bedrock_runtime.invoke_model(
                modelId=model_id,
                body=json.dumps(request_body)
            )
            
            response_body = json.loads(response['body'].read())
            
            # Extract response text based on model type
            if "anthropic.claude" in model_id:
                response_text = response_body.get('content', [{}])[0].get('text', 'No response generated')
            elif "amazon.titan" in model_id:
                response_text = response_body.get('results', [{}])[0].get('outputText', 'No response generated')
            elif "ai21.j2" in model_id:
                response_text = response_body.get('completions', [{}])[0].get('data', {}).get('text', 'No response generated')
            else:
                response_text = str(response_body)
            
            generation_time = time.time() - start_time
            
            return {
                'response': response_text.strip(),
                'model_id': model_id,
                'temperature': temperature,
                'max_tokens': max_tokens,
                'generation_time': generation_time,
                'timestamp': datetime.utcnow().isoformat(),
                'context_used': len(context),
                'prompt_length': len(prompt)
            }
            
        except ClientError as e:
            logger.error(f"Error generating response: {e}")
            raise Exception(f"Response generation failed: {e}")
        except Exception as e:
            logger.error(f"Unexpected error in response generation: {e}")
            raise
    
    def query_and_generate(
        self, 
        query: str, 
        max_results: int = 5,
        model_id: str = "anthropic.claude-3-sonnet-20240229-v1:0",
        temperature: float = 0.7,
        max_tokens: int = 4096,
        search_type: str = "HYBRID"
    ) -> Dict[str, Any]:
        """
        Complete RAG pipeline: retrieve context and generate response
        
        Args:
            query: User question
            max_results: Max KB results to retrieve
            model_id: Foundation model for generation
            temperature: Model temperature
            max_tokens: Max tokens to generate
            search_type: KB search type
        
        Returns:
            Complete RAG response with sources and metadata
        """
        try:
            # Step 1: Retrieve context from Knowledge Base
            kb_result = self.query_knowledge_base(
                query=query,
                max_results=max_results,
                search_type=search_type
            )
            
            # Step 2: Extract context for generation
            context = [result['content'] for result in kb_result['results']]
            
            # Step 3: Generate response using context
            generation_result = self.generate_response(
                query=query,
                context=context,
                model_id=model_id,
                temperature=temperature,
                max_tokens=max_tokens
            )
            
            # Step 4: Combine results
            return {
                'query': query,
                'response': generation_result['response'],
                'sources': self._format_sources(kb_result['results']),
                'metadata': {
                    'kb_query_time': kb_result['query_time'],
                    'generation_time': generation_result['generation_time'],
                    'total_time': kb_result['query_time'] + generation_result['generation_time'],
                    'total_results': kb_result['total_results'],
                    'model_id': model_id,
                    'search_type': search_type,
                    'temperature': temperature,
                    'timestamp': datetime.utcnow().isoformat()
                }
            }
            
        except Exception as e:
            logger.error(f"Error in complete RAG pipeline: {e}")
            raise
    
    def list_available_models(self) -> List[Dict[str, Any]]:
        """List available foundation models"""
        try:
            if 'models' in self._model_cache:
                return self._model_cache['models']
            
            bedrock_client = boto3.client('bedrock', region_name=self.region)
            response = bedrock_client.list_foundation_models()
            
            models = []
            for model in response.get('modelSummaries', []):
                model_info = {
                    'modelId': model['modelId'],
                    'modelName': model['modelName'],
                    'providerName': model['providerName'],
                    'inputModalities': model.get('inputModalities', []),
                    'outputModalities': model.get('outputModalities', []),
                    'responseStreamingSupported': model.get('responseStreamingSupported', False),
                    'customizationsSupported': model.get('customizationsSupported', []),
                    'inferenceTypesSupported': model.get('inferenceTypesSupported', [])
                }
                models.append(model_info)
            
            # Cache the results
            self._model_cache['models'] = models
            
            return models
            
        except Exception as e:
            logger.error(f"Error listing models: {e}")
            return []
    
    def get_model_info(self, model_id: str) -> Optional[Dict[str, Any]]:
        """Get detailed information about a specific model"""
        models = self.list_available_models()
        for model in models:
            if model['modelId'] == model_id:
                return model
        return None
    
    def test_model_connectivity(self, model_id: str) -> bool:
        """Test if a model is accessible and working"""
        try:
            test_query = "Hello, this is a test."
            
            if "anthropic.claude" in model_id:
                request_body = {
                    "anthropic_version": "bedrock-2023-05-31",
                    "max_tokens": 10,
                    "temperature": 0.1,
                    "messages": [{"role": "user", "content": test_query}]
                }
            else:
                request_body = {
                    "inputText": test_query,
                    "textGenerationConfig": {
                        "maxTokenCount": 10,
                        "temperature": 0.1
                    }
                }
            
            response = self.bedrock_runtime.invoke_model(
                modelId=model_id,
                body=json.dumps(request_body)
            )
            
            return response['ResponseMetadata']['HTTPStatusCode'] == 200
            
        except Exception as e:
            logger.error(f"Model connectivity test failed for {model_id}: {e}")
            return False
    
    def _extract_location_info(self, location: Dict[str, Any]) -> Dict[str, Any]:
        """Extract and format location information from KB result"""
        if location.get('type') == 'S3':
            s3_location = location.get('s3Location', {})
            return {
                'type': 'S3',
                'uri': s3_location.get('uri', ''),
                'bucket': s3_location.get('uri', '').split('/')[2] if s3_location.get('uri') else '',
                'key': '/'.join(s3_location.get('uri', '').split('/')[3:]) if s3_location.get('uri') else ''
            }
        return location
    
    def _format_sources(self, results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Format KB results as source citations"""
        sources = []
        for i, result in enumerate(results):
            source = {
                'index': i + 1,
                'content_preview': result['content'][:200] + '...' if len(result['content']) > 200 else result['content'],
                'score': round(result['score'], 3),
                'location': result['location']
            }
            
            # Add document name if available
            if result['location'].get('type') == 'S3':
                key = result['location'].get('key', '')
                if key:
                    source['document_name'] = key.split('/')[-1]
            
            sources.append(source)
        
        return sources
    
    def get_embedding_info(self) -> Dict[str, Any]:
        """Get information about the embedding model being used"""
        return {
            'model': self.config.get('embeddingModel', 'Unknown'),
            'dimensions': self.config.get('vectorDimensions', 'Unknown'),
            'chunk_size': self.config.get('chunkSize', 'Unknown'),
            'chunk_overlap': self.config.get('chunkOverlap', 'Unknown'),
        } 