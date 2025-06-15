"""
RAG Demo - Main Streamlit Application
Enterprise-ready Knowledge Base interface with AWS Bedrock integration
"""

import os
import sys
import streamlit as st
import asyncio
from mangum import Mangum
from typing import Dict, Any

# Add components to path
sys.path.append(os.path.join(os.path.dirname(__file__), 'components'))
sys.path.append(os.path.join(os.path.dirname(__file__), 'utils'))

# Import components
from components.chat_interface import ChatInterface
from components.document_manager import DocumentManager
from components.analytics import Analytics
from components.system_status import SystemStatus
from components.settings import Settings
from utils.config_loader import ConfigLoader
from utils.bedrock_client import BedrockClient

# Configure Streamlit page
st.set_page_config(
    page_title="RAG Demo - Knowledge Base",
    page_icon="🤖",
    layout="wide",
    initial_sidebar_state="expanded",
    menu_items={
        'Get Help': 'https://github.com/your-org/rag-demo',
        'Report a bug': 'https://github.com/your-org/rag-demo/issues',
        'About': "# RAG Demo\nEnterprise-ready Retrieval Augmented Generation with AWS Bedrock"
    }
)

# Custom CSS
st.markdown("""
<style>
    .main-header {
        font-size: 2.5rem;
        font-weight: 700;
        background: linear-gradient(90deg, #FF6B6B, #4ECDC4);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        text-align: center;
        margin-bottom: 2rem;
    }
    
    .sidebar-content {
        padding: 1rem;
    }
    
    .metric-card {
        background: #f0f2f6;
        padding: 1rem;
        border-radius: 0.5rem;
        border-left: 4px solid #4ECDC4;
        margin: 0.5rem 0;
    }
    
    .status-indicator {
        display: inline-block;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        margin-right: 8px;
    }
    
    .status-healthy { background-color: #4CAF50; }
    .status-warning { background-color: #FF9800; }
    .status-error { background-color: #F44336; }
    
    .chat-container {
        background: white;
        border-radius: 10px;
        padding: 1rem;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        margin: 1rem 0;
    }
    
    .document-upload-area {
        border: 2px dashed #4ECDC4;
        border-radius: 10px;
        padding: 2rem;
        text-align: center;
        background: #f8f9fa;
        margin: 1rem 0;
    }
    
    .footer {
        margin-top: 3rem;
        padding: 2rem;
        background: #f8f9fa;
        border-radius: 10px;
        text-align: center;
        font-size: 0.9rem;
        color: #666;
    }
</style>
""", unsafe_allow_html=True)

class RAGDemoApp:
    """Main RAG Demo Application Class"""
    
    def __init__(self):
        self.config_loader = ConfigLoader()
        self.config = self.config_loader.load_config()
        self.bedrock_client = BedrockClient(self.config)
        
        # Initialize session state
        self.init_session_state()
        
        # Initialize components
        self.chat_interface = ChatInterface(self.bedrock_client, self.config)
        self.document_manager = DocumentManager(self.config)
        self.analytics = Analytics(self.config)
        self.system_status = SystemStatus(self.config)
        self.settings = Settings(self.config)

    def init_session_state(self):
        """Initialize Streamlit session state variables"""
        if 'messages' not in st.session_state:
            st.session_state.messages = []
        
        if 'current_page' not in st.session_state:
            st.session_state.current_page = "Chat"
        
        if 'user_preferences' not in st.session_state:
            st.session_state.user_preferences = {
                'theme': 'light',
                'auto_scroll': True,
                'show_source_citations': True,
                'max_results': 5,
                'temperature': 0.7,
            }
        
        if 'system_health' not in st.session_state:
            st.session_state.system_health = {
                'status': 'healthy',
                'last_check': None,
                'metrics': {}
            }

    def render_sidebar(self):
        """Render the sidebar navigation and status"""
        with st.sidebar:
            st.markdown('<div class="sidebar-content">', unsafe_allow_html=True)
            
            # Logo and title
            st.markdown("""
                <div style="text-align: center; margin-bottom: 2rem;">
                    <h2>🤖 RAG Demo</h2>
                    <p style="color: #666; font-size: 0.9rem;">Knowledge Base Interface</p>
                </div>
            """, unsafe_allow_html=True)
            
            # Navigation
            pages = ["Chat", "Documents", "Analytics", "System Status", "Settings"]
            
            for page in pages:
                if st.button(
                    page, 
                    key=f"nav_{page}",
                    use_container_width=True,
                    type="primary" if st.session_state.current_page == page else "secondary"
                ):
                    st.session_state.current_page = page
                    st.rerun()
            
            st.divider()
            
            # Quick status
            status = st.session_state.system_health['status']
            status_color = {
                'healthy': '#4CAF50',
                'warning': '#FF9800',
                'error': '#F44336'
            }.get(status, '#666')
            
            st.markdown(f"""
                <div class="metric-card">
                    <div style="display: flex; align-items: center;">
                        <span class="status-indicator" style="background-color: {status_color};"></span>
                        <strong>System Status: {status.title()}</strong>
                    </div>
                </div>
            """, unsafe_allow_html=True)
            
            # Environment info
            st.markdown(f"""
                <div class="metric-card">
                    <strong>Environment:</strong> {self.config.get('environment', 'dev')}<br>
                    <strong>Region:</strong> {self.config.get('region', 'us-east-1')}<br>
                    <strong>Model:</strong> {self.config.get('embeddingModel', 'titan')}
                </div>
            """, unsafe_allow_html=True)
            
            st.markdown('</div>', unsafe_allow_html=True)

    def render_main_content(self):
        """Render the main content area based on current page"""
        current_page = st.session_state.current_page
        
        if current_page == "Chat":
            self.render_chat_page()
        elif current_page == "Documents":
            self.render_documents_page()
        elif current_page == "Analytics":
            self.render_analytics_page()
        elif current_page == "System Status":
            self.render_system_status_page()
        elif current_page == "Settings":
            self.render_settings_page()

    def render_chat_page(self):
        """Render the chat interface page"""
        st.markdown('<h1 class="main-header">💬 Knowledge Base Chat</h1>', unsafe_allow_html=True)
        
        # Quick stats
        col1, col2, col3, col4 = st.columns(4)
        
        with col1:
            st.metric("Messages Today", len(st.session_state.messages), delta="2")
        
        with col2:
            st.metric("Avg Response Time", "1.2s", delta="-0.3s")
        
        with col3:
            st.metric("Knowledge Base Docs", "1,234", delta="12")
        
        with col4:
            st.metric("Success Rate", "98.5%", delta="0.5%")
        
        st.divider()
        
        # Chat interface
        self.chat_interface.render()

    def render_documents_page(self):
        """Render the document management page"""
        st.markdown('<h1 class="main-header">📚 Document Management</h1>', unsafe_allow_html=True)
        
        # Document manager
        self.document_manager.render()

    def render_analytics_page(self):
        """Render the analytics dashboard page"""
        st.markdown('<h1 class="main-header">📊 Analytics Dashboard</h1>', unsafe_allow_html=True)
        
        # Analytics dashboard
        self.analytics.render()

    def render_system_status_page(self):
        """Render the system status page"""
        st.markdown('<h1 class="main-header">⚡ System Status</h1>', unsafe_allow_html=True)
        
        # System status
        self.system_status.render()

    def render_settings_page(self):
        """Render the settings page"""
        st.markdown('<h1 class="main-header">⚙️ Settings</h1>', unsafe_allow_html=True)
        
        # Settings
        self.settings.render()

    def render_footer(self):
        """Render the footer"""
        st.markdown("""
            <div class="footer">
                <p>
                    <strong>RAG Demo</strong> - Enterprise Knowledge Base powered by 
                    <a href="https://aws.amazon.com/bedrock/" target="_blank">AWS Bedrock</a> 
                    and <a href="https://streamlit.io/" target="_blank">Streamlit</a>
                </p>
                <p>
                    Built with ❤️ using AWS CDK | 
                    <a href="https://github.com/your-org/rag-demo" target="_blank">View Source</a> | 
                    <a href="https://docs.aws.amazon.com/bedrock/" target="_blank">Documentation</a>
                </p>
            </div>
        """, unsafe_allow_html=True)

    def run(self):
        """Main application run method"""
        try:
            # Check system health on startup
            if st.session_state.system_health['last_check'] is None:
                with st.spinner("Checking system health..."):
                    health_status = self.system_status.check_system_health()
                    st.session_state.system_health.update(health_status)
            
            # Render sidebar
            self.render_sidebar()
            
            # Render main content
            self.render_main_content()
            
            # Render footer
            self.render_footer()
            
        except Exception as e:
            st.error(f"Application error: {str(e)}")
            st.exception(e)

# Initialize and run the app
app = RAGDemoApp()

def main():
    """Main entry point for local development"""
    app.run()

# Lambda handler for serverless deployment
def lambda_handler(event, context):
    """AWS Lambda handler for serverless Streamlit deployment"""
    
    # Configure Streamlit for Lambda
    os.environ['STREAMLIT_SERVER_HEADLESS'] = 'true'
    os.environ['STREAMLIT_SERVER_ENABLE_CORS'] = 'false'
    os.environ['STREAMLIT_SERVER_ENABLE_XSRF_PROTECTION'] = 'false'
    
    # Create Mangum adapter
    from streamlit.web import cli as stcli
    import sys
    
    # Override sys.argv for Streamlit
    sys.argv = ['streamlit', 'run', __file__, '--server.headless', 'true']
    
    # Run the app
    app.run()
    
    return {
        'statusCode': 200,
        'body': 'Streamlit app is running'
    }

# Mangum ASGI adapter for Lambda
asgi_app = Mangum(lambda_handler)

if __name__ == "__main__":
    # Check if running in Lambda environment
    if os.environ.get('AWS_LAMBDA_FUNCTION_NAME'):
        # Running in Lambda
        handler = lambda_handler
    else:
        # Running locally
        main() 