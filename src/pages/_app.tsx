import type { AppProps } from 'next/app'


function MyApp({ Component, pageProps }: AppProps) {
  return (
    <>
      {/* <Script 
        src="https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.min.js"
        strategy="beforeInteractive"
      /> */}
      <Component {...pageProps} />
    </>
  )
}

export default MyApp