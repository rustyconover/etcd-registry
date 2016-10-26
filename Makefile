SRC = $(wildcard src/*.js)
LIB = $(SRC:src/%.js=lib/%.js)

lib: $(LIB) lib/index.js.flow
lib/%.js: src/%.js .babelrc .eslintrc
	mkdir -p $(@D)
	eslint -f unix $< --no-color
	babel $< -o $@ --presets airbnb --source-maps inline

lib/index.js.flow: src/index.js
	flow gen-flow-files src/index.js > lib/index.js.flow
