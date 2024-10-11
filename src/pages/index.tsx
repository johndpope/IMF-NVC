import { useEffect, useState,useRef } from 'react'
import { ONNXModelLoader } from '../utils/ONNXModelLoader'

export default function Home() {
  const [inferenceResult, setInferenceResult] = useState<string>('')

  const inferenceRun = useRef(false)

  useEffect(() => {
    async function runInference() {
      if (inferenceRun.current) return
      inferenceRun.current = true

      try {
        const modelLoader = new ONNXModelLoader()
        await modelLoader.loadModel('/imf_encoder.onnx')
        
        const xCurrent = await ONNXModelLoader.imageToFloat32Array('/frame1.png')
        const xReference = await ONNXModelLoader.imageToFloat32Array('/frame2.png')
        
        const [fr, tr, tc] = await modelLoader.runInference(xCurrent, xReference)
        
        setInferenceResult(JSON.stringify({
          fr: Array.from(fr.slice(0, 5)),
          tr: Array.from(tr.slice(0, 5)),
          tc: Array.from(tc.slice(0, 5))
        }, null, 2))
      } catch (error) {
        console.error('Error in inference:', error)
        setInferenceResult(`Error: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    runInference()
  }, [])

  return (
    <div>
      <h1>IMF Neural Video Codec POC</h1>
      <div>
        <img src="/frame1.png" alt="Frame 1" width={256} height={256} />
        <img src="/frame2.png" alt="Frame 2" width={256} height={256} />
      </div>
      <h2>Inference Results:</h2>
      <pre>{inferenceResult}</pre>
    </div>
  )
}