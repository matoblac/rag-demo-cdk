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
# Note: Other components planned for future releases (see Documentation/docs/ROADMAP.md)
# from components.document_manager import DocumentManager
# from components.analytics import Analytics  
# from components.system_status import SystemStatus
# from components.settings import Settings
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
        # Note: Other components planned for future releases (see Documentation/docs/ROADMAP.md)
        # self.document_manager = DocumentManager(self.config)
        # self.analytics = Analytics(self.config)
        # self.system_status = SystemStatus(self.config)
        # self.settings = Settings(self.config)

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
            pages = ["Chat"]  # Demo scope - see ROADMAP.md for planned features
            planned_pages = ["Documents", "Analytics", "System Status", "Settings"]
            
            for page in pages:
                if st.button(
                    page, 
                    key=f"nav_{page}",
                    use_container_width=True,
                    type="primary" if st.session_state.current_page == page else "secondary"
                ):
                    st.session_state.current_page = page
                    st.rerun()
            
            # Show planned features
            st.markdown("**🚧 Planned Features:**")
            for page in planned_pages:
                st.button(
                    f"🔜 {page}", 
                    key=f"planned_{page}",
                    use_container_width=True,
                    disabled=True,
                    help="Planned for future release - see Documentation/docs/ROADMAP.md"
                )
            
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
        
        # Placeholder for future implementation
        st.info("🚧 **Coming Soon!** Document management interface is planned for a future release.")
        st.markdown("**Planned Features:**")
        st.markdown("- 📋 List all documents in Knowledge Base")
        st.markdown("- 📊 Document ingestion status monitoring") 
        st.markdown("- 🗑️ Upload, delete, and manage documents")
        st.markdown("- 📈 Document usage analytics")
        st.markdown("\n**For now, use AWS CLI or S3 Console to manage documents.**")
        st.markdown("See [Roadmap](Documentation/docs/ROADMAP.md) for details.")

    def render_analytics_page(self):
        """Render the analytics dashboard page"""
        st.markdown('<h1 class="main-header">📊 Analytics Dashboard</h1>', unsafe_allow_html=True)
        
        # Placeholder for future implementation
        st.info("🚧 **Coming Soon!** Usage analytics dashboard is planned for a future release.")
        st.markdown("**Planned Features:**")
        st.markdown("- 📈 Query frequency and patterns")
        st.markdown("- 📚 Document popularity rankings")
        st.markdown("- ⚡ Performance metrics and trends")
        st.markdown("- 💰 Cost tracking and optimization")
        st.markdown("- 👥 User behavior insights")
        st.markdown("\nSee [Roadmap](Documentation/docs/ROADMAP.md) for details.")

    def render_system_status_page(self):
        """Render the system status page"""
        st.markdown('<h1 class="main-header">⚡ System Status</h1>', unsafe_allow_html=True)
        
        # Placeholder for future implementation
        st.info("🚧 **Coming Soon!** System monitoring interface is planned for a future release.")
        st.markdown("**Planned Features:**")
        st.markdown("- 🔍 Real-time infrastructure health")
        st.markdown("- 📊 CloudWatch metrics integration")
        st.markdown("- 🔔 Automated alerts and notifications")
        st.markdown("- 🏥 System diagnostics and troubleshooting")
        st.markdown("- 📈 Capacity monitoring and scaling")
        st.markdown("\n**For now, check AWS Console for system status.**")
        st.markdown("See [Roadmap](Documentation/docs/ROADMAP.md) for details.")

    def render_settings_page(self):
        """Render the settings page"""
        st.markdown('<h1 class="main-header">⚙️ Settings</h1>', unsafe_allow_html=True)
        
        # Placeholder for future implementation
        st.info("🚧 **Coming Soon!** Advanced settings interface is planned for a future release.")
        st.markdown("**Planned Features:**")
        st.markdown("- 👤 User preferences and themes")
        st.markdown("- 🤖 Model configuration and fine-tuning")
        st.markdown("- 🔐 Access controls and permissions")
        st.markdown("- 🌐 API management and rate limiting")
        st.markdown("- 📊 Knowledge Base configuration")
        st.markdown("\n**Current settings can be adjusted in the chat sidebar.**")
        st.markdown("See [Roadmap](Documentation/docs/ROADMAP.md) for details.")

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
                    <a href="Documentation/docs/ROADMAP.md" target="_blank">🗺️ Roadmap</a>
                </p>
                <p style="font-size: 0.8rem; color: #999;">
                    Demo scope: Chat interface with RAG capabilities. 
                    Document management, analytics, and system monitoring coming soon!
                </p>
            </div>
        """, unsafe_allow_html=True)

    def run(self):
        """Main application run method"""
        try:
            # Basic health check (full system monitoring planned for future release)
            if st.session_state.system_health['last_check'] is None:
                st.session_state.system_health.update({
                    'status': 'healthy',
                    'last_check': 'Demo mode - full monitoring coming soon',
                    'metrics': {}
                })
            
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