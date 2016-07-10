SRC = $(wildcard src/*.js)
LIB = $(SRC:src/%.js=lib/%.js)

lib: $(LIB)
lib/%.js: src/%.js .babelrc
	mkdir -p $(@D)
	./node_modules/.bin/eslint -f unix $< --no-color
	./node_modules/.bin/babel $< -o $@ --presets airbnb --source-maps inline
