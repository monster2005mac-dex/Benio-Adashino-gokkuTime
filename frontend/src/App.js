import "@/App.css";
import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import KuohFlowApp from "@/kuohflow/KuohFlowApp";
import { AuthProvider, Protected, AuthPage } from "@/kuohflow/Auth";

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Protected><KuohFlowApp /></Protected>} />
          <Route path="/login" element={<AuthPage />} />
          <Route path="*" element={
            <div className="min-h-screen bg-[#080911] flex items-center justify-center text-slate-300 text-sm">
              <Link to="/" className="underline text-rose-300">Back to Gokaku</Link>
            </div>
          } />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;