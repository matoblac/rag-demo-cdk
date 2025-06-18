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
sys.path.append(os.path.join(os.path.dirname(__file__), "components"))
sys.path.append(os.path.join(os.path.dirname(__file__), "utils"))

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
        "Get Help": "https://github.com/your-org/rag-demo",
        "Report a bug": "https://github.com/your-org/rag-demo/issues",
        "About": "# RAG Demo\nEnterprise-ready Retrieval Augmented Generation with AWS Bedrock",
    },
)

# Custom CSS - Bright, modern theme
st.markdown(
    """
<style>
    /* Import Google Fonts */
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
    
    /* Global theme overrides */
    .stApp {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        min-height: 100vh;
    }
    
    .main .block-container {
        background: rgba(255, 255, 255, 0.98);
        border-radius: 20px;
        padding: 2rem;
        margin-top: 1rem;
        margin-bottom: 1rem;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
        backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 255, 255, 0.6);
    }
    
    /* Beautiful header with animated gradient */
    .main-header {
        font-family: 'Inter', sans-serif;
        font-size: 3rem;
        font-weight: 700;
        background: linear-gradient(45deg, #667eea, #764ba2, #f093fb, #f5576c);
        background-size: 300% 300%;
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
        text-align: center;
        margin-bottom: 2rem;
        animation: gradientShift 3s ease infinite;
    }
    
    @keyframes gradientShift {
        0% { background-position: 0% 50%; }
        50% { background-position: 100% 50%; }
        100% { background-position: 0% 50%; }
    }
    
    /* Sidebar styling */
    .stSidebar > div:first-child {
        background: linear-gradient(180deg, #667eea 0%, #764ba2 100%);
        border-radius: 0 20px 20px 0;
    }
    
    .sidebar-content {
        padding: 1.5rem;
        color: white;
    }
    
    .sidebar-content h2 {
        color: white !important;
        text-shadow: 0 2px 4px rgba(0,0,0,0.3);
    }
    
    .sidebar-content p {
        color: rgba(255, 255, 255, 0.8) !important;
    }
    
    /* Modern metric cards with glassmorphism */
    .metric-card {
        background: rgba(255, 255, 255, 0.95);
        backdrop-filter: blur(15px);
        border: 1px solid rgba(255, 255, 255, 0.4);
        padding: 1.5rem;
        border-radius: 16px;
        margin: 0.75rem 0;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
        transition: transform 0.3s ease, box-shadow 0.3s ease;
    }
    
    .metric-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.15);
    }
    
    /* Status indicators with glow effect */
    .status-indicator {
        display: inline-block;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        margin-right: 10px;
        box-shadow: 0 0 10px currentColor;
        animation: pulse 2s infinite;
    }
    
    @keyframes pulse {
        0% { opacity: 1; }
        50% { opacity: 0.7; }
        100% { opacity: 1; }
    }
    
    .status-healthy { 
        background: linear-gradient(45deg, #4CAF50, #81C784);
        box-shadow: 0 0 15px #4CAF50;
    }
    .status-warning { 
        background: linear-gradient(45deg, #FF9800, #FFB74D);
        box-shadow: 0 0 15px #FF9800;
    }
    .status-error { 
        background: linear-gradient(45deg, #F44336, #E57373);
        box-shadow: 0 0 15px #F44336;
    }
    
    /* Chat container with modern design */
    .chat-container {
        background: rgba(255, 255, 255, 0.95);
        border-radius: 20px;
        padding: 2rem;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
        margin: 1.5rem 0;
        border: 1px solid rgba(255, 255, 255, 0.3);
        backdrop-filter: blur(15px);
    }
    
    /* Document upload area with hover effects */
    .document-upload-area {
        border: 3px dashed #667eea;
        border-radius: 20px;
        padding: 3rem;
        text-align: center;
        background: linear-gradient(135deg, rgba(102, 126, 234, 0.1), rgba(118, 75, 162, 0.1));
        margin: 2rem 0;
        transition: all 0.3s ease;
        cursor: pointer;
    }
    
    .document-upload-area:hover {
        border-color: #764ba2;
        background: linear-gradient(135deg, rgba(102, 126, 234, 0.2), rgba(118, 75, 162, 0.2));
        transform: translateY(-2px);
        box-shadow: 0 10px 30px rgba(102, 126, 234, 0.2);
    }
    
    /* Modern footer */
    .footer {
        margin-top: 3rem;
        padding: 2.5rem;
        background: linear-gradient(135deg, rgba(102, 126, 234, 0.1), rgba(118, 75, 162, 0.1));
        border-radius: 20px;
        text-align: center;
        font-size: 0.95rem;
        color: #2c3e50 !important;
        border: 1px solid rgba(102, 126, 234, 0.2);
    }
    
    .footer p {
        color: #2c3e50 !important;
    }
    
    .footer a {
        color: #667eea;
        text-decoration: none;
        font-weight: 500;
        transition: color 0.3s ease;
    }
    
    .footer a:hover {
        color: #764ba2;
        text-decoration: underline;
    }
    
    /* Button styling improvements */
    .stButton > button {
        background: linear-gradient(45deg, #667eea, #764ba2) !important;
        color: white !important;
        border: none !important;
        border-radius: 12px !important;
        padding: 0.75rem 1.5rem !important;
        font-weight: 500 !important;
        font-family: 'Inter', sans-serif !important;
        transition: all 0.3s ease !important;
        box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3) !important;
    }
    
    .stButton > button:hover {
        transform: translateY(-2px) !important;
        box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4) !important;
    }
    
    .stButton > button:active {
        transform: translateY(0) !important;
    }
    
    /* Disabled button styling */
    .stButton > button:disabled {
        background: linear-gradient(45deg, #ccc, #999) !important;
        color: #666 !important;
        cursor: not-allowed !important;
        transform: none !important;
        box-shadow: none !important;
    }
    
    /* Metrics styling */
    .metric-container {
        background: rgba(255, 255, 255, 0.98);
        border-radius: 16px;
        padding: 1.5rem;
        box-shadow: 0 8px 25px rgba(0, 0, 0, 0.15);
        border: 1px solid rgba(102, 126, 234, 0.2);
        backdrop-filter: blur(15px);
        transition: transform 0.3s ease;
    }
    
    .metric-container:hover {
        transform: translateY(-3px);
    }
    
    /* Input field styling */
    .stTextInput > div > div > input {
        border-radius: 12px !important;
        border: 2px solid #e0e0e0 !important;
        padding: 0.75rem !important;
        font-family: 'Inter', sans-serif !important;
    }
    
    .stTextInput > div > div > input:focus {
        border-color: #667eea !important;
        box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1) !important;
    }
    
    /* Selectbox styling */
    .stSelectbox > div > div {
        border-radius: 12px !important;
        border: 2px solid #e0e0e0 !important;
    }
    
    /* Warning/info box improvements */
    .stAlert {
        border-radius: 16px !important;
        border: none !important;
        box-shadow: 0 8px 25px rgba(0, 0, 0, 0.1) !important;
    }
    
    /* Slider improvements */
    .stSlider > div > div > div {
        background: linear-gradient(45deg, #667eea, #764ba2) !important;
    }
    
    /* Additional text contrast fixes for Streamlit components */
    .stInfo, .stSuccess, .stWarning, .stError {
        color: #2c3e50 !important;
    }
    
    .stInfo p, .stSuccess p, .stWarning p, .stError p {
        color: #2c3e50 !important;
    }
    
    /* Hide Streamlit branding */
    #MainMenu {visibility: hidden;}
    footer {visibility: hidden;}
    .stDeployButton {display: none;}
    
    /* Ensure proper text contrast */
    .main .block-container p,
    .main .block-container div,
    .main .block-container span,
    .main .block-container li {
        color: #2c3e50 !important;
    }
    
    .main .block-container h1,
    .main .block-container h2,
    .main .block-container h3,
    .main .block-container h4,
    .main .block-container h5,
    .main .block-container h6 {
        color: #1a252f !important;
    }
    
    /* Streamlit specific text fixes */
    .stMarkdown p {
        color: #2c3e50 !important;
    }
    
    .stMarkdown h1, .stMarkdown h2, .stMarkdown h3, .stMarkdown h4 {
        color: #1a252f !important;
    }
    
    .stMarkdown li {
        color: #2c3e50 !important;
    }
    
    .stMarkdown strong {
        color: #1a252f !important;
    }
    
    /* Chat interface text */
    .chat-container p,
    .chat-container div,
    .chat-container span {
        color: #2c3e50 !important;
    }
    
    /* Metric cards text contrast */
    .metric-card p,
    .metric-card div,
    .metric-card span {
        color: #1a252f !important;
    }
    
    .metric-container p,
    .metric-container div,
    .metric-container span {
        color: #1a252f !important;
    }
    
    /* Add subtle animations */
    .main .block-container {
        animation: fadeIn 0.5s ease-in;
    }
    
    @keyframes fadeIn {
        from { opacity: 0; transform: translateY(20px); }
        to { opacity: 1; transform: translateY(0); }
    }
</style>
""",
    unsafe_allow_html=True,
)


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
        if "messages" not in st.session_state:
            st.session_state.messages = []

        if "current_page" not in st.session_state:
            st.session_state.current_page = "Chat"

        if "user_preferences" not in st.session_state:
            st.session_state.user_preferences = {
                "theme": "light",
                "auto_scroll": True,
                "show_source_citations": True,
                "max_results": 5,
                "temperature": 0.7,
            }

        if "system_health" not in st.session_state:
            st.session_state.system_health = {
                "status": "healthy",
                "last_check": None,
                "metrics": {},
            }

    def render_sidebar(self):
        """Render the sidebar navigation and status"""
        with st.sidebar:
            st.markdown('<div class="sidebar-content">', unsafe_allow_html=True)

            # Logo and title
            st.markdown(
                """
                <div style="text-align: center; margin-bottom: 2rem;">
                    <h2 style="color: white; font-size: 1.8rem; margin-bottom: 0.5rem; text-shadow: 0 2px 4px rgba(0,0,0,0.3);">🤖 RAG Demo</h2>
                    <p style="color: rgba(255, 255, 255, 0.9); font-size: 1rem; margin: 0; font-weight: 300;">Knowledge Base Interface</p>
                </div>
            """,
                unsafe_allow_html=True,
            )

            # Navigation
            pages = ["Chat"]  # Demo scope - see ROADMAP.md for planned features
            planned_pages = ["Documents", "Analytics", "System Status", "Settings"]

            for page in pages:
                if st.button(
                    page,
                    key=f"nav_{page}",
                    use_container_width=True,
                    type=(
                        "primary"
                        if st.session_state.current_page == page
                        else "secondary"
                    ),
                ):
                    st.session_state.current_page = page
                    st.rerun()

            # Show planned features
            st.markdown(
                """
                <div style="margin: 1rem 0;">
                    <h4 style="color: rgba(255, 255, 255, 0.9); font-size: 0.9rem; margin-bottom: 0.75rem; text-transform: uppercase; letter-spacing: 1px;">
                        🚧 Planned Features
                    </h4>
                </div>
            """,
                unsafe_allow_html=True,
            )

            for page in planned_pages:
                st.button(
                    f"🔜 {page}",
                    key=f"planned_{page}",
                    use_container_width=True,
                    disabled=True,
                    help="Planned for future release - see Documentation/docs/ROADMAP.md",
                )

            st.divider()

            # Quick status
            status = st.session_state.system_health["status"]
            status_color = {
                "healthy": "#4CAF50",
                "warning": "#FF9800",
                "error": "#F44336",
            }.get(status, "#666")

            st.markdown(
                f"""
                <div class="metric-card">
                    <div style="display: flex; align-items: center;">
                        <span class="status-indicator" style="background-color: {status_color};"></span>
                        <strong>System Status: {status.title()}</strong>
                    </div>
                </div>
            """,
                unsafe_allow_html=True,
            )

            # Environment info
            st.markdown(
                f"""
                <div class="metric-card">
                    <strong>Environment:</strong> {self.config.get('environment', 'dev')}<br>
                    <strong>Region:</strong> {self.config.get('region', 'us-east-1')}<br>
                    <strong>Model:</strong> {self.config.get('embeddingModel', 'titan')}
                </div>
            """,
                unsafe_allow_html=True,
            )

            st.markdown("</div>", unsafe_allow_html=True)

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
        st.markdown(
            '<h1 class="main-header">💬 Knowledge Base Chat</h1>',
            unsafe_allow_html=True,
        )

        # Show development mode banner if using placeholder values
        if self.config.get("knowledgeBaseId") == "local-dev-placeholder-kb-id":
            st.markdown(
                """
                <div style="background: linear-gradient(135deg, rgba(255, 193, 7, 0.1), rgba(255, 152, 0, 0.1)); 
                           border: 2px solid #ffc107; border-radius: 16px; padding: 1.5rem; margin: 1.5rem 0;
                           box-shadow: 0 8px 25px rgba(255, 193, 7, 0.2);">
                    <div style="display: flex; align-items: center; margin-bottom: 1rem;">
                        <div style="font-size: 1.5rem; margin-right: 0.75rem;">🛠️</div>
                        <h3 style="color: #e65100; margin: 0; font-weight: 600;">Local Development Mode</h3>
                    </div>
                    <p style="color: #bf360c; margin-bottom: 1rem; font-size: 0.95rem;">
                        Using placeholder configuration - limited functionality available
                    </p>
                    <div style="background: white; border-radius: 12px; padding: 1rem; margin: 1rem 0;">
                        <h4 style="color: #27ae60; margin: 0 0 0.5rem 0; font-size: 0.9rem;">🚀 To get full functionality:</h4>
                        <ol style="color: #2c3e50; margin: 0; padding-left: 1.2rem;">
                            <li>Deploy infrastructure: <code>./scripts/deploy.sh dev</code></li>
                            <li>Use the deployed frontend URL instead of local</li>
                        </ol>
                    </div>
                    <div style="background: rgba(244, 67, 54, 0.1); border-radius: 12px; padding: 1rem;">
                        <h4 style="color: #c62828; margin: 0 0 0.5rem 0; font-size: 0.9rem;">⚠️ Current limitations:</h4>
                        <ul style="color: #2c3e50; margin: 0; padding-left: 1.2rem;">
                            <li>Chat responses will be placeholder messages</li>
                            <li>No real document search capability</li>
                            <li>Cannot upload or manage documents</li>
                        </ul>
                    </div>
                </div>
            """,
                unsafe_allow_html=True,
            )

        # Simple conversation counter (only real metric)
        if len(st.session_state.messages) > 0:
            st.markdown(
                """
                <div style="background: rgba(102, 126, 234, 0.1); border-radius: 12px; padding: 1rem; margin: 1.5rem 0; text-align: center;">
                    <span style="color: #2c3e50; font-size: 0.9rem;">
                        💬 <strong>{} messages</strong> in this conversation
                    </span>
                </div>
            """.format(
                    len(st.session_state.messages)
                ),
                unsafe_allow_html=True,
            )

        st.divider()

        # Chat interface
        self.chat_interface.render()

    def render_documents_page(self):
        """Render the document management page"""
        st.markdown(
            '<h1 class="main-header">📚 Document Management</h1>',
            unsafe_allow_html=True,
        )

        # Placeholder for future implementation
        st.info(
            "🚧 **Coming Soon!** Document management interface is planned for a future release."
        )
        st.markdown("**Planned Features:**")
        st.markdown("- 📋 List all documents in Knowledge Base")
        st.markdown("- 📊 Document ingestion status monitoring")
        st.markdown("- 🗑️ Upload, delete, and manage documents")
        st.markdown("- 📈 Document usage analytics")
        st.markdown("\n**For now, use AWS CLI or S3 Console to manage documents.**")
        st.markdown("See [Roadmap](Documentation/docs/ROADMAP.md) for details.")

    def render_analytics_page(self):
        """Render the analytics dashboard page"""
        st.markdown(
            '<h1 class="main-header">📊 Analytics Dashboard</h1>',
            unsafe_allow_html=True,
        )

        # Placeholder for future implementation
        st.info(
            "🚧 **Coming Soon!** Usage analytics dashboard is planned for a future release."
        )
        st.markdown("**Planned Features:**")
        st.markdown("- 📈 Query frequency and patterns")
        st.markdown("- 📚 Document popularity rankings")
        st.markdown("- ⚡ Performance metrics and trends")
        st.markdown("- 💰 Cost tracking and optimization")
        st.markdown("- 👥 User behavior insights")
        st.markdown("\nSee [Roadmap](Documentation/docs/ROADMAP.md) for details.")

    def render_system_status_page(self):
        """Render the system status page"""
        st.markdown(
            '<h1 class="main-header">⚡ System Status</h1>', unsafe_allow_html=True
        )

        # Placeholder for future implementation
        st.info(
            "🚧 **Coming Soon!** System monitoring interface is planned for a future release."
        )
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
        st.info(
            "🚧 **Coming Soon!** Advanced settings interface is planned for a future release."
        )
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
        st.markdown(
            """
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
        """,
            unsafe_allow_html=True,
        )

    def run(self):
        """Main application run method"""
        try:
            # Basic health check (full system monitoring planned for future release)
            if st.session_state.system_health["last_check"] is None:
                st.session_state.system_health.update(
                    {
                        "status": "healthy",
                        "last_check": "Demo mode - full monitoring coming soon",
                        "metrics": {},
                    }
                )

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
    os.environ["STREAMLIT_SERVER_HEADLESS"] = "true"
    os.environ["STREAMLIT_SERVER_ENABLE_CORS"] = "false"
    os.environ["STREAMLIT_SERVER_ENABLE_XSRF_PROTECTION"] = "false"

    # Create Mangum adapter
    from streamlit.web import cli as stcli
    import sys

    # Override sys.argv for Streamlit
    sys.argv = ["streamlit", "run", __file__, "--server.headless", "true"]

    # Run the app
    app.run()

    return {"statusCode": 200, "body": "Streamlit app is running"}


# Mangum ASGI adapter for Lambda
asgi_app = Mangum(lambda_handler)

if __name__ == "__main__":
    # Check if running in Lambda environment
    if os.environ.get("AWS_LAMBDA_FUNCTION_NAME"):
        # Running in Lambda
        handler = lambda_handler
    else:
        # Running locally
        main()
