SRC = background.js blank.html extension.js extension.css manifest.json

ICON = pig_nose_16_0.png pig_nose_16_1.png pig_nose_16_2.png pig_nose_16_3.png \
       pig_nose_16_4.png pig_nose_16_+.png pig_nose_48.png pig_nose_128.png

LIB = jquery-2.0.3.min.js

all: clear copyfiles copylibfiles

clear: 
	if [ -d dist ]; then rm -r dist; fi
	
copyfiles: $(SRC:%=src/%) $(ICON:%=icon/%)
	mkdir dist
	cp $^ dist

copylibfiles: $(LIB:%=lib/%)
	mkdir dist/lib
	cp $^ dist/lib

src/extension.css: src/extension.scss
	sass $< $@

