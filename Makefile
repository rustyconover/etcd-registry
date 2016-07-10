SRC = $(wildcard src/*.js)
LIB = $(SRC:src/%.js=lib/%.js)

lib: $(LIB)
lib/%.js: src/%.js .babelrc
	mkdir -p $(@D)
	eslint -f unix $< --no-color
	babel $< -o $@ --presets airbnb --source-maps inline
