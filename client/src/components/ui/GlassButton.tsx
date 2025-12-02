export function GlassButton({ children, onClick }: any) {
  return (
    <button
      onClick={onClick}
      className="px-4 py-2 rounded-lg border border-white/30
                 bg-white/10 backdrop-blur-md text-slate-100
                 hover:bg-white/20 hover:shadow-glass
                 transition-all duration-300"
    >
      {children}
    </button>
  );
}