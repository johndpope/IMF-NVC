use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Tensor {
    data: Vec<f32>,
    shape: Vec<usize>,
}

#[wasm_bindgen]
impl Tensor {
    #[wasm_bindgen(constructor)]
    pub fn new(data: Vec<f32>, shape: Vec<usize>) -> Self {
        Self { data, shape }
    }

    pub fn reshape(&mut self, new_shape: Vec<usize>) {
        let total_size: usize = new_shape.iter().product();
        assert_eq!(total_size, self.data.len());
        self.shape = new_shape;
    }

    pub fn get_data(&self) -> Vec<f32> {
        self.data.clone()
    }
}
