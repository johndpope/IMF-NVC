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
tree -I 'node_modules|target|dist|pkg' -L 2 > tree.txt
cat js.combined src.combined tree.txt > project.txt

rm src.combined
rm js.combined