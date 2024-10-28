#!/bin/zsh

# Source zshrc to get access to the functions
source ~/.zshrc

cd js
dump ts
mv js.combined ..
cd ..
cd src
dump rs
mv src.combined ..
cd ..
cat js.combined src.combined > js+rs.txt

rm src.combined
rm js.combined