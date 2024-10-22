import type { NextPage } from 'next'
import dynamic from 'next/dynamic'

// Dynamically import the ModelInference component
const ModelInference = dynamic(
  () => import('@/components/ModelInference'),
  { ssr: false }
)

const Home: NextPage = () => {
  const modelPath = '/graph_model/model.json' // Place in public folder
  const imagePaths = [
    '/000000.png',
    '/000018.png',

  ]

  return (
    <div className="min-h-screen p-4">
      <h1 className="text-2xl font-bold mb-4">TensorFlow.js Next.js Demo</h1>
      <ModelInference 
        modelPath={modelPath}
        imagePaths={imagePaths}
      />
    </div>
  )
}

export default Home