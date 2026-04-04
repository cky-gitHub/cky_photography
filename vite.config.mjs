export default ({ command }) => ({
  base: command === "build" ? "/cky_photography/" : "/",
  build: {
    outDir: "docs",
    emptyOutDir: true,
  },
});
