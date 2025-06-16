"""
Chat Interface Component
Sophisticated chat interface for Knowledge Base interactions
"""

import streamlit as st
import time
import json
from typing import Dict, Any, List, Optional
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

class ChatInterface:
    """Chat interface for Knowledge Base queries"""
    
    def __init__(self, bedrock_client, config: Dict[str, Any]):
        self.bedrock_client = bedrock_client
        self.config = config
        
    def render(self):
        """Render the complete chat interface"""
        
        # Chat settings in sidebar
        with st.sidebar:
            st.markdown("### Chat Settings")
            
            # Model selection
            models = self._get_available_models()
            selected_model = st.selectbox(
                "Model",
                options=models,
                index=0 if models else 0,
                help="Choose the foundation model for generating responses"
            )
            
            # Search settings
            max_results = st.slider(
                "Max Knowledge Base Results",
                min_value=1,
                max_value=10,
                value=st.session_state.user_preferences.get('max_results', 5),
                help="Maximum number of documents to retrieve from Knowledge Base"
            )
            
            search_type = st.selectbox(
                "Search Type",
                options=["HYBRID", "SEMANTIC", "KEYWORD"],
                index=0,
                help="Type of search to perform in Knowledge Base"
            )
            
            # Generation settings
            temperature = st.slider(
                "Temperature",
                min_value=0.0,
                max_value=1.0,
                value=st.session_state.user_preferences.get('temperature', 0.7),
                step=0.1,
                help="Controls randomness in response generation"
            )
            
            max_tokens = st.slider(
                "Max Tokens",
                min_value=100,
                max_value=8192,
                value=4096,
                step=100,
                help="Maximum tokens to generate"
            )
            
            # Advanced options
            with st.expander("Advanced Options"):
                show_sources = st.checkbox(
                    "Show Source Citations",
                    value=st.session_state.user_preferences.get('show_source_citations', True)
                )
                
                show_metadata = st.checkbox("Show Metadata", value=False)
                
                auto_scroll = st.checkbox(
                    "Auto-scroll to Latest",
                    value=st.session_state.user_preferences.get('auto_scroll', True)
                )
        
        # Update preferences
        st.session_state.user_preferences.update({
            'max_results': max_results,
            'temperature': temperature,
            'show_source_citations': show_sources,
            'auto_scroll': auto_scroll
        })
        
        # Main chat interface
        self._render_chat_area()
        
        # Chat input
        self._render_chat_input(
            model_id=selected_model,
            max_results=max_results,
            search_type=search_type,
            temperature=temperature,
            max_tokens=max_tokens,
            show_sources=show_sources,
            show_metadata=show_metadata
        )
        
        # Sample questions
        self._render_sample_questions()
    
    def _render_chat_area(self):
        """Render the chat message area"""
        st.markdown("### 💬 Conversation")
        
        # Chat container
        chat_container = st.container()
        
        with chat_container:
            if not st.session_state.messages:
                st.markdown("""
                    <div class="chat-container">
                        <p style="text-align: center; color: #666; font-style: italic;">
                            👋 Welcome! Ask me anything about the documents in the knowledge base.
                        </p>
                    </div>
                """, unsafe_allow_html=True)
            else:
                for i, message in enumerate(st.session_state.messages):
                    self._render_message(message, i)
        
        # Auto-scroll to bottom if enabled
        if st.session_state.user_preferences.get('auto_scroll', True) and st.session_state.messages:
            st.markdown("""
                <script>
                    var element = window.parent.document.querySelector('[data-testid="stVerticalBlock"]');
                    element.scrollTop = element.scrollHeight;
                </script>
            """, unsafe_allow_html=True)
    
    def _render_message(self, message: Dict[str, Any], index: int):
        """Render a single chat message"""
        is_user = message['role'] == 'user'
        
        # Message container
        with st.container():
            col1, col2 = st.columns([1, 4] if is_user else [4, 1])
            
            with col2 if is_user else col1:
                # Avatar and metadata
                avatar = "👤" if is_user else "🤖"
                timestamp = message.get('timestamp', '')
                
                if is_user:
                    st.markdown(f"""
                        <div style="text-align: right; margin-bottom: 1rem;">
                            <div style="background: #e3f2fd; padding: 1rem; border-radius: 15px 15px 5px 15px; 
                                       display: inline-block; max-width: 80%; text-align: left;">
                                <strong>{avatar} You</strong><br>
                                {message['content']}
                            </div>
                            <div style="font-size: 0.8rem; color: #666; margin-top: 0.5rem;">
                                {timestamp}
                            </div>
                        </div>
                    """, unsafe_allow_html=True)
                else:
                    st.markdown(f"""
                        <div style="margin-bottom: 1rem;">
                            <div style="background: #f5f5f5; padding: 1rem; border-radius: 15px 15px 15px 5px; 
                                       display: inline-block; max-width: 80%;">
                                <strong>{avatar} Assistant</strong><br>
                                {message['content']}
                            </div>
                        </div>
                    """, unsafe_allow_html=True)
                    
                    # Show sources if available
                    if message.get('sources') and st.session_state.user_preferences.get('show_source_citations', True):
                        with st.expander(f"📚 Sources ({len(message['sources'])} documents)", expanded=False):
                            for source in message['sources']:
                                self._render_source(source)
                    
                    # Show metadata if requested
                    if message.get('metadata'):
                        with st.expander("🔍 Metadata", expanded=False):
                            st.json(message['metadata'])
                    
                    # Response actions
                    col_a, col_b, col_c = st.columns([1, 1, 2])
                    
                    with col_a:
                        if st.button("👍", key=f"like_{index}", help="Good response"):
                            self._handle_feedback(index, 'like')
                    
                    with col_b:
                        if st.button("👎", key=f"dislike_{index}", help="Poor response"):
                            self._handle_feedback(index, 'dislike')
                    
                    with col_c:
                        if st.button("🔄 Regenerate", key=f"regen_{index}", help="Generate new response"):
                            self._regenerate_response(index)
                    
                    # Timestamp
                    st.markdown(f"""
                        <div style="font-size: 0.8rem; color: #666; margin-top: 0.5rem;">
                            {timestamp}
                        </div>
                    """, unsafe_allow_html=True)
    
    def _render_source(self, source: Dict[str, Any]):
        """Render a source citation"""
        st.markdown(f"""
            <div style="border-left: 3px solid #4ECDC4; padding-left: 1rem; margin: 0.5rem 0;">
                <strong>📄 {source.get('document_name', 'Document')} (Score: {source.get('score', 0):.3f})</strong><br>
                <em>{source.get('content_preview', 'No preview available')}</em><br>
                <small>Location: {source.get('location', {}).get('uri', 'Unknown')}</small>
            </div>
        """, unsafe_allow_html=True)
    
    def _render_chat_input(self, **kwargs):
        """Render the chat input area"""
        st.markdown("---")
        
        # Input form
        with st.form(key="chat_form", clear_on_submit=True):
            col1, col2 = st.columns([4, 1])
            
            with col1:
                user_input = st.text_area(
                    "Your question:",
                    placeholder="Ask anything about the documents in the knowledge base...",
                    height=100,
                    key="chat_input"
                )
            
            with col2:
                st.markdown("<br>", unsafe_allow_html=True)  # Spacing
                submit_button = st.form_submit_button("Send 🚀", use_container_width=True)
                
                if st.form_submit_button("Clear Chat 🗑️", use_container_width=True):
                    st.session_state.messages = []
                    st.rerun()
        
        # Handle message submission
        if submit_button and user_input.strip():
            self._handle_user_message(user_input.strip(), **kwargs)
    
    def _render_sample_questions(self):
        """Render sample questions for quick testing"""
        with st.expander("💡 Sample Questions", expanded=False):
            sample_questions = [
                "What are the main topics covered in the knowledge base?",
                "Can you summarize the key concepts?",
                "What information is available about [specific topic]?",
                "How does [concept A] relate to [concept B]?",
                "What are the latest updates or changes mentioned?"
            ]
            
            st.markdown("Click on a question to try it:")
            
            for i, question in enumerate(sample_questions):
                if st.button(question, key=f"sample_{i}", use_container_width=True):
                    # Add the question to chat input
                    st.session_state.messages.append({
                        'role': 'user',
                        'content': question,
                        'timestamp': datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    })
                    
                    # Generate response
                    self._generate_response(question, **{
                        'model_id': 'anthropic.claude-3-5-sonnet-20240620-v1:0',
                        'max_results': 5,
                        'search_type': 'HYBRID',
                        'temperature': 0.7,
                        'max_tokens': 4096,
                        'show_sources': True,
                        'show_metadata': False
                    })
                    
                    st.rerun()
    
    def _handle_user_message(self, message: str, **kwargs):
        """Handle a new user message"""
        # Add user message to session
        st.session_state.messages.append({
            'role': 'user',
            'content': message,
            'timestamp': datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        })
        
        # Generate response
        self._generate_response(message, **kwargs)
        
        st.rerun()
    
    def _generate_response(self, query: str, **kwargs):
        """Generate assistant response"""
        try:
            with st.spinner("🤔 Thinking..."):
                # Query Knowledge Base and generate response
                result = self.bedrock_client.query_and_generate(
                    query=query,
                    max_results=kwargs.get('max_results', 5),
                    model_id=kwargs.get('model_id', 'anthropic.claude-3-5-sonnet-20240620-v1:0'),
                    temperature=kwargs.get('temperature', 0.7),
                    max_tokens=kwargs.get('max_tokens', 4096),
                    search_type=kwargs.get('search_type', 'HYBRID')
                )
                
                # Add assistant response to session
                assistant_message = {
                    'role': 'assistant',
                    'content': result['response'],
                    'timestamp': datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    'sources': result.get('sources', []) if kwargs.get('show_sources', True) else [],
                    'metadata': result.get('metadata', {}) if kwargs.get('show_metadata', False) else {}
                }
                
                st.session_state.messages.append(assistant_message)
                
        except Exception as e:
            logger.error(f"Error generating response: {e}")
            
            # Add error message
            error_message = {
                'role': 'assistant',
                'content': f"I apologize, but I encountered an error while processing your request: {str(e)}",
                'timestamp': datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                'error': True
            }
            
            st.session_state.messages.append(error_message)
    
    def _handle_feedback(self, message_index: int, feedback_type: str):
        """Handle user feedback on responses"""
        if message_index < len(st.session_state.messages):
            message = st.session_state.messages[message_index]
            message['feedback'] = feedback_type
            message['feedback_timestamp'] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            
            # Show feedback confirmation
            if feedback_type == 'like':
                st.success("👍 Thanks for the positive feedback!")
            else:
                st.info("👎 Thanks for the feedback. We'll work to improve responses.")
    
    def _regenerate_response(self, message_index: int):
        """Regenerate a response for a specific message"""
        if message_index > 0 and message_index < len(st.session_state.messages):
            # Get the user message that prompted this response
            user_message = st.session_state.messages[message_index - 1]
            
            if user_message['role'] == 'user':
                # Remove the current assistant response
                st.session_state.messages.pop(message_index)
                
                # Generate new response
                self._generate_response(
                    user_message['content'],
                    model_id='anthropic.claude-3-5-sonnet-20240620-v1:0',
                    max_results=5,
                    search_type='HYBRID',
                    temperature=0.7,
                    max_tokens=4096,
                    show_sources=True,
                    show_metadata=False
                )
                
                st.rerun()
    
    def _get_available_models(self) -> List[str]:
        """Get list of available models"""
        try:
            models = self.bedrock_client.list_available_models()
            
            # Filter for text generation models
            text_models = []
            for model in models:
                if 'TEXT' in model.get('outputModalities', []):
                    text_models.append(model['modelId'])
            
            # Default models if none found
            if not text_models:
                text_models = [
                    'anthropic.claude-3-5-sonnet-20240620-v1:0',
                    'anthropic.claude-3-haiku-20240307-v1:0',
                    'amazon.titan-text-express-v1'
                ]
            
            return text_models
            
        except Exception as e:
            logger.error(f"Error getting available models: {e}")
            return ['anthropic.claude-3-5-sonnet-20240620-v1:0']
    
    def export_conversation(self) -> Dict[str, Any]:
        """Export the current conversation"""
        return {
            'messages': st.session_state.messages,
            'export_timestamp': datetime.now().isoformat(),
            'config': self.config,
            'user_preferences': st.session_state.user_preferences
        }
    
    def import_conversation(self, conversation_data: Dict[str, Any]):
        """Import a conversation"""
        st.session_state.messages = conversation_data.get('messages', [])
        if 'user_preferences' in conversation_data:
            st.session_state.user_preferences.update(conversation_data['user_preferences']) 